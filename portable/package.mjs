import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const portableDir = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(portableDir, "..");
const buildDir = resolve(projectDir, "work", "portable-build");
const outputsDir = resolve(projectDir, "outputs");
const shareDir = resolve(outputsDir, "fanorona-offline-share");
const htmlPath = resolve(outputsDir, "fanorona-offline.html");

const files = await readdir(buildDir);
const scriptName = files.find((file) => file.endsWith(".js"));
const styleName = files.find((file) => file.endsWith(".css"));

if (!scriptName || !styleName) {
  throw new Error("Portable build did not emit JavaScript and CSS");
}

const [scriptSource, styleSource] = await Promise.all([
  readFile(resolve(buildDir, scriptName), "utf8"),
  readFile(resolve(buildDir, styleName), "utf8"),
]);
const thirdPartyNotices = await readFile(resolve(projectDir, "THIRD_PARTY_NOTICES.md"), "utf8");

const safeScript = scriptSource.replaceAll("</script", "<\\/script");
const safeStyle = styleSource.replaceAll("</style", "<\\/style");
const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="theme-color" content="#171a18">
  <title>棋局参谋 - 离线版</title>
  <style>${safeStyle}</style>
</head>
<body>
  <div id="root"></div>
  <noscript>请启用浏览器 JavaScript 后再打开棋局参谋。</noscript>
  <script>
  if (window.location.protocol === "file:") {
    document.getElementById("root").innerHTML = '<main style="max-width:680px;margin:12vh auto;padding:28px;font-family:Segoe UI,Microsoft YaHei,sans-serif;color:#171a18"><h1 style="font-size:28px">请使用便携版启动</h1><p style="line-height:1.8;color:#59635c">浏览器会限制本地 file:// 页面创建计算线程，因此单 HTML 无法可靠运行棋类 AI。Windows 请运行便携版 EXE，安卓请安装 APK；它们会在安全的本机环境中启动同一套棋盘与引擎。</p></main>';
  } else {
    ${safeScript}
  }
  </script>
</body>
</html>
`;

const instructions = `棋局参谋 - 离线分享版

使用方法：
单 HTML 仅适合通过本地 HTTP 或 HTTPS 提供，不能保证在 file:// 模式运行计算线程。
Windows 请改用便携版 EXE，安卓请改用 APK。两者都不需要联网或 AI Token。
`;

await mkdir(outputsDir, { recursive: true });
await rm(shareDir, { recursive: true, force: true });
await mkdir(shareDir, { recursive: true });
await Promise.all([
  writeFile(htmlPath, html, "utf8"),
  writeFile(resolve(shareDir, "棋局参谋.html"), html, "utf8"),
  writeFile(resolve(shareDir, "使用说明.txt"), instructions, "utf8"),
  writeFile(resolve(shareDir, "第三方开源许可.txt"), thirdPartyNotices, "utf8"),
]);

console.log(`Portable HTML: ${htmlPath}`);
