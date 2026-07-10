import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const mobileDir = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(mobileDir, "..");
const buildDir = resolve(projectDir, "work", "mobile-pwa");
const publicDir = resolve(projectDir, "public");
const outputsDir = resolve(projectDir, "outputs");
const outputDir = resolve(outputsDir, "fanorona-mobile-pwa");

await mkdir(resolve(buildDir, "icons"), { recursive: true });
await Promise.all([
  cp(resolve(publicDir, "manifest.webmanifest"), resolve(buildDir, "manifest.webmanifest")),
  cp(resolve(publicDir, "sw.js"), resolve(buildDir, "sw.js")),
  cp(resolve(publicDir, "favicon.svg"), resolve(buildDir, "favicon.svg")),
  cp(resolve(publicDir, "icons"), resolve(buildDir, "icons"), { recursive: true }),
]);

const htmlPath = resolve(buildDir, "index.html");
const workerPath = resolve(buildDir, "sw.js");
const html = await readFile(htmlPath, "utf8");
const assetMatches = [...html.matchAll(/(?:src|href)="\.\/(assets\/[^"?#]+)"/g)];
const appAssets = [...new Set(assetMatches.map((match) => `./${match[1]}`))];
let serviceWorker = await readFile(workerPath, "utf8");
serviceWorker = serviceWorker.replace(
  "/*__MOBILE_PRECACHE__*/",
  `PRECACHE.push(${appAssets.map((asset) => JSON.stringify(asset)).join(", ")});`,
);
await writeFile(workerPath, serviceWorker, "utf8");

await mkdir(outputsDir, { recursive: true });
await rm(outputDir, { recursive: true, force: true });
await cp(buildDir, outputDir, { recursive: true });

const instructions = `迂棋参谋手机端（PWA）

这个文件夹是可安装网页应用：
1. 将整个文件夹部署到任意支持 HTTPS 的静态网站。
2. 用安卓 Chrome 打开网址。
3. 点击页面上的安装按钮，或在浏览器菜单选择“安装应用”。
4. 首次打开后可离线使用，不消耗 AI Token。

若不想部署网站，请直接安装安卓 APK。浏览器的 file:// 模式会限制计算线程，不再作为正式交付方式。
`;

await writeFile(resolve(outputDir, "安装说明.txt"), instructions, "utf8");

const portableHtml = resolve(outputsDir, "fanorona-offline.html");
await cp(portableHtml, resolve(outputsDir, "fanorona-mobile-offline.html"));

const outputFiles = await readdir(outputDir);
console.log(`Mobile PWA: ${outputDir} (${outputFiles.length} top-level files)`);
