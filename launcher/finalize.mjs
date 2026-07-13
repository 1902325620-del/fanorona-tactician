import { copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const launcherDir = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(launcherDir, "..");
const publishDir = resolve(projectDir, "work", "launcher-publish");
const outputsDir = resolve(projectDir, "outputs");
const shareDir = resolve(outputsDir, "fanorona-offline-share");
const files = await readdir(publishDir);
const executable = files.find((file) => file.toLowerCase().endsWith(".exe"));

if (!executable) throw new Error("Windows launcher executable was not produced");
await mkdir(outputsDir, { recursive: true });
await mkdir(shareDir, { recursive: true });
const sourceExecutable = resolve(publishDir, executable);
await Promise.all([
  copyFile(sourceExecutable, resolve(outputsDir, "fanorona-windows-portable.exe")),
  copyFile(sourceExecutable, resolve(outputsDir, "board-tactician-windows-portable.exe")),
  copyFile(sourceExecutable, resolve(shareDir, "棋局参谋-Windows便携版.exe")),
  writeFile(
    resolve(shareDir, "使用说明.txt"),
    `棋局参谋 - Windows 便携版

双击“棋局参谋-Windows便携版.exe”即可使用。
它会在本机 127.0.0.1 临时启动页面并自动打开默认浏览器，不监听局域网，不需要安装 Node，不需要联网，也不消耗 AI Token。

“棋局参谋.html”只用于解释 file:// 的浏览器限制，请不要把它当作正式启动入口。
`,
    "utf8",
  ),
]);
