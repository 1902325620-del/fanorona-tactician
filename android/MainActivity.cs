using Android.App;
using Android.Content.PM;
using Android.OS;
using Android.Views;
using Android.Webkit;
using Android.Widget;
using Color = Android.Graphics.Color;

namespace FanoronaTactician.AndroidApp;

[Activity(
    Label = "棋局参谋",
    MainLauncher = true,
    Exported = true,
    Icon = "@mipmap/appicon",
    Theme = "@style/AppTheme",
    ConfigurationChanges = ConfigChanges.Orientation |
                           ConfigChanges.ScreenSize |
                           ConfigChanges.UiMode |
                           ConfigChanges.KeyboardHidden)]
public sealed class MainActivity : Activity
{
    private WebView? webView;

    protected override void OnCreate(Bundle? savedInstanceState)
    {
        base.OnCreate(savedInstanceState);

        var root = new FrameLayout(this);
        root.SetBackgroundColor(Color.Rgb(244, 246, 243));

        webView = new WebView(this);
        webView.SetBackgroundColor(Color.Rgb(244, 246, 243));
        webView.Settings.JavaScriptEnabled = true;
        webView.Settings.DomStorageEnabled = true;
        webView.Settings.DatabaseEnabled = false;
        webView.Settings.AllowFileAccess = false;
        webView.Settings.AllowContentAccess = false;
        webView.Settings.MediaPlaybackRequiresUserGesture = true;
        webView.Settings.BuiltInZoomControls = false;
        webView.Settings.DisplayZoomControls = false;
        webView.Settings.MixedContentMode = MixedContentHandling.NeverAllow;
        webView.Settings.CacheMode = CacheModes.Normal;
        if (OperatingSystem.IsAndroidVersionAtLeast(30) &&
            !OperatingSystem.IsAndroidVersionAtLeast(35))
        {
            Window?.SetDecorFitsSystemWindows(false);
        }
        webView.SetWebViewClient(
            new LocalAssetClient(Assets ?? throw new InvalidOperationException("Android assets unavailable")));
        webView.SetWebChromeClient(new WebChromeClient());

        root.AddView(
            webView,
            new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MatchParent,
                ViewGroup.LayoutParams.MatchParent));
        if (OperatingSystem.IsAndroidVersionAtLeast(30))
        {
            root.SetOnApplyWindowInsetsListener(new SafeAreaInsetsListener());
        }

        SetContentView(root);
        root.RequestApplyInsets();
        webView.LoadUrl("https://app.local/index.html?native=android");
    }

    protected override void OnDestroy()
    {
        webView?.StopLoading();
        webView?.Destroy();
        webView = null;
        base.OnDestroy();
    }
}

internal sealed class SafeAreaInsetsListener : Java.Lang.Object, View.IOnApplyWindowInsetsListener
{
    public WindowInsets OnApplyWindowInsets(View view, WindowInsets insets)
    {
        if (!OperatingSystem.IsAndroidVersionAtLeast(30)) return insets;

        var safeInsets = insets.GetInsets(
            WindowInsets.Type.SystemBars() | WindowInsets.Type.DisplayCutout());
        view.SetPadding(safeInsets.Left, safeInsets.Top, safeInsets.Right, safeInsets.Bottom);
        var handledTypes = WindowInsets.Type.SystemBars() | WindowInsets.Type.DisplayCutout();
        return new WindowInsets.Builder(insets)
            .SetInsets(handledTypes, Android.Graphics.Insets.Of(0, 0, 0, 0))
            .Build();
    }
}

internal sealed class LocalAssetClient(Android.Content.Res.AssetManager assets) : WebViewClient
{
    private const string LocalHost = "app.local";

    public override WebResourceResponse? ShouldInterceptRequest(
        WebView? view,
        IWebResourceRequest? request)
    {
        var uri = request?.Url;
        if (uri?.Host != LocalHost) return base.ShouldInterceptRequest(view, request);

        var path = Uri.UnescapeDataString(uri.Path?.TrimStart('/') ?? string.Empty);
        if (path.Length == 0) path = "index.html";
        if (path.Split('/').Any(segment => segment is "." or ".."))
        {
            return EmptyResponse("text/plain");
        }

        try
        {
            return new WebResourceResponse(GetMimeType(path), "utf-8", assets.Open(path));
        }
        catch (System.IO.FileNotFoundException)
        {
            return EmptyResponse("text/plain");
        }
    }

    public override bool ShouldOverrideUrlLoading(WebView? view, IWebResourceRequest? request)
    {
        return request?.Url?.Host != LocalHost;
    }

    private static WebResourceResponse EmptyResponse(string mimeType) =>
        new(mimeType, "utf-8", new MemoryStream(Array.Empty<byte>()));

    private static string GetMimeType(string path) => System.IO.Path.GetExtension(path).ToLowerInvariant() switch
    {
        ".html" => "text/html",
        ".js" => "text/javascript",
        ".css" => "text/css",
        ".json" or ".webmanifest" => "application/manifest+json",
        ".svg" => "image/svg+xml",
        ".png" => "image/png",
        ".txt" => "text/plain",
        _ => "application/octet-stream",
    };
}
