using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;

namespace FanoronaTactician;

internal static class Program
{
    private static async Task<int> Main(string[] args)
    {
        Console.OutputEncoding = Encoding.UTF8;
        Console.Title = "棋局参谋";

        await using var server = new LoopbackServer(preferredPort: 39777);
        var url = $"http://127.0.0.1:{server.Port}/";

        if (args.Contains("--self-test", StringComparer.OrdinalIgnoreCase))
        {
            return await RunSelfTest(url);
        }

        Console.WriteLine("棋局参谋已启动");
        Console.WriteLine($"地址：{url}");
        Console.WriteLine("此窗口只提供本机页面，关闭窗口即可停止。不会向外联网。\n");

        try
        {
            Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
        }
        catch
        {
            Console.WriteLine("未能自动打开浏览器，请手动打开上面的地址。");
        }

        var stopped = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        Console.CancelKeyPress += (_, eventArgs) =>
        {
            eventArgs.Cancel = true;
            stopped.TrySetResult();
        };
        await stopped.Task;
        return 0;
    }

    private static async Task<int> RunSelfTest(string url)
    {
        using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
        var html = await client.GetStringAsync(url);
        var manifest = await client.GetStringAsync(new Uri(new Uri(url), "manifest.webmanifest"));
        var worker = await client.GetStringAsync(new Uri(new Uri(url), "sw.js"));
        var assetPaths = Regex.Matches(html, "(?:src|href)=\"\\./(assets/[^\"?#]+)\"")
            .Select(match => match.Groups[1].Value)
            .Distinct(StringComparer.Ordinal)
            .ToArray();

        if (!html.Contains("棋局参谋", StringComparison.Ordinal) ||
            !manifest.Contains("\"display\": \"standalone\"", StringComparison.Ordinal) ||
            !worker.Contains("board-tactician", StringComparison.Ordinal) ||
            assetPaths.Length < 2)
        {
            Console.Error.WriteLine("Embedded web application validation failed.");
            return 1;
        }

        foreach (var assetPath in assetPaths)
        {
            var bytes = await client.GetByteArrayAsync(new Uri(new Uri(url), assetPath));
            if (bytes.Length == 0)
            {
                Console.Error.WriteLine($"Embedded asset is empty: {assetPath}");
                return 1;
            }
        }

        Console.WriteLine($"Self-test passed: {url}");
        return 0;
    }
}

internal sealed class LoopbackServer : IAsyncDisposable
{
    private const int MaxHeaderBytes = 16 * 1024;
    private readonly TcpListener listener;
    private readonly CancellationTokenSource cancellation = new();
    private readonly Task acceptLoop;
    private readonly IReadOnlyDictionary<string, string> resources;

    public LoopbackServer(int preferredPort)
    {
        resources = LoadResourceMap();
        listener = StartListener(preferredPort);
        Port = ((IPEndPoint)listener.LocalEndpoint).Port;
        acceptLoop = AcceptLoopAsync(cancellation.Token);
    }

    public int Port { get; }

    public async ValueTask DisposeAsync()
    {
        cancellation.Cancel();
        listener.Stop();
        try
        {
            await acceptLoop;
        }
        catch (OperationCanceledException)
        {
        }
        cancellation.Dispose();
    }

    private static TcpListener StartListener(int preferredPort)
    {
        try
        {
            var preferred = new TcpListener(IPAddress.Loopback, preferredPort);
            preferred.Start();
            return preferred;
        }
        catch (SocketException)
        {
            var fallback = new TcpListener(IPAddress.Loopback, 0);
            fallback.Start();
            return fallback;
        }
    }

    private async Task AcceptLoopAsync(CancellationToken token)
    {
        while (!token.IsCancellationRequested)
        {
            TcpClient client;
            try
            {
                client = await listener.AcceptTcpClientAsync(token);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (ObjectDisposedException)
            {
                break;
            }

            _ = Task.Run(() => HandleClientAsync(client, token), token);
        }
    }

    private async Task HandleClientAsync(TcpClient client, CancellationToken token)
    {
        using (client)
        {
            client.NoDelay = true;
            await using var stream = client.GetStream();
            var request = await ReadRequestAsync(stream, token);
            if (request is null)
            {
                await WriteErrorAsync(stream, 400, "Bad Request", token);
                return;
            }

            var parts = request.Split(' ', 3, StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length < 2 || (parts[0] != "GET" && parts[0] != "HEAD"))
            {
                await WriteErrorAsync(stream, 405, "Method Not Allowed", token);
                return;
            }

            var path = NormalizePath(parts[1]);
            if (path is null)
            {
                await WriteErrorAsync(stream, 403, "Forbidden", token);
                return;
            }

            if (!resources.TryGetValue(path, out var resourceName))
            {
                await WriteErrorAsync(stream, 404, "Not Found", token);
                return;
            }

            await using var body = Assembly.GetExecutingAssembly().GetManifestResourceStream(resourceName);
            if (body is null)
            {
                await WriteErrorAsync(stream, 404, "Not Found", token);
                return;
            }

            var mime = GetMimeType(path);
            var cache = path is "index.html" or "sw.js" or "manifest.webmanifest"
                ? "no-cache"
                : "public, max-age=31536000, immutable";
            var headers =
                "HTTP/1.1 200 OK\r\n" +
                $"Content-Type: {mime}\r\n" +
                $"Content-Length: {body.Length}\r\n" +
                $"Cache-Control: {cache}\r\n" +
                "X-Content-Type-Options: nosniff\r\n" +
                "Referrer-Policy: no-referrer\r\n" +
                "Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; worker-src 'self' blob:; connect-src 'self'; manifest-src 'self'\r\n" +
                "Connection: close\r\n\r\n";
            await stream.WriteAsync(Encoding.ASCII.GetBytes(headers), token);
            if (parts[0] == "GET")
            {
                await body.CopyToAsync(stream, token);
            }
        }
    }

    private static async Task<string?> ReadRequestAsync(NetworkStream stream, CancellationToken token)
    {
        var buffer = new byte[MaxHeaderBytes];
        var length = 0;
        while (length < buffer.Length)
        {
            var read = await stream.ReadAsync(buffer.AsMemory(length, buffer.Length - length), token);
            if (read == 0) return null;
            length += read;
            var headerEnd = FindHeaderEnd(buffer, length);
            if (headerEnd >= 0)
            {
                var headers = Encoding.ASCII.GetString(buffer, 0, headerEnd);
                var lineEnd = headers.IndexOf("\r\n", StringComparison.Ordinal);
                return lineEnd >= 0 ? headers[..lineEnd] : headers;
            }
        }
        return null;
    }

    private static int FindHeaderEnd(byte[] buffer, int length)
    {
        for (var index = 3; index < length; index++)
        {
            if (buffer[index - 3] == '\r' && buffer[index - 2] == '\n' &&
                buffer[index - 1] == '\r' && buffer[index] == '\n')
            {
                return index - 3;
            }
        }
        return -1;
    }

    private static string? NormalizePath(string rawTarget)
    {
        var queryIndex = rawTarget.IndexOf('?');
        if (queryIndex >= 0) rawTarget = rawTarget[..queryIndex];
        var path = Uri.UnescapeDataString(rawTarget).Replace('\\', '/').TrimStart('/');
        if (path.Length == 0) path = "index.html";
        if (path.Split('/').Any(segment => segment is ".." or ".")) return null;
        return path;
    }

    private static IReadOnlyDictionary<string, string> LoadResourceMap()
    {
        var assembly = Assembly.GetExecutingAssembly();
        return assembly
            .GetManifestResourceNames()
            .Where(name => name.StartsWith("web/", StringComparison.Ordinal))
            .ToDictionary(
                name => name[4..].Replace('\\', '/'),
                name => name,
                StringComparer.OrdinalIgnoreCase);
    }

    private static string GetMimeType(string path) => Path.GetExtension(path).ToLowerInvariant() switch
    {
        ".html" => "text/html; charset=utf-8",
        ".js" => "text/javascript; charset=utf-8",
        ".css" => "text/css; charset=utf-8",
        ".json" or ".webmanifest" => "application/manifest+json; charset=utf-8",
        ".svg" => "image/svg+xml",
        ".png" => "image/png",
        ".wasm" => "application/wasm",
        ".txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    };

    private static async Task WriteErrorAsync(
        NetworkStream stream,
        int status,
        string reason,
        CancellationToken token)
    {
        var body = Encoding.UTF8.GetBytes(reason);
        var response =
            $"HTTP/1.1 {status} {reason}\r\n" +
            "Content-Type: text/plain; charset=utf-8\r\n" +
            $"Content-Length: {body.Length}\r\n" +
            "Connection: close\r\n\r\n";
        await stream.WriteAsync(Encoding.ASCII.GetBytes(response), token);
        await stream.WriteAsync(body, token);
    }
}
