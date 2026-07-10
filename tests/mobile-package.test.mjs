import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const projectDir = resolve(import.meta.dirname, "..");
const mobileDir = resolve(projectDir, "outputs", "fanorona-mobile-pwa");

test("mobile PWA has an installable offline shell", async () => {
  const [html, manifestText, serviceWorker] = await Promise.all([
    readFile(resolve(mobileDir, "index.html"), "utf8"),
    readFile(resolve(mobileDir, "manifest.webmanifest"), "utf8"),
    readFile(resolve(mobileDir, "sw.js"), "utf8"),
  ]);
  const manifest = JSON.parse(manifestText);

  assert.equal(manifest.name, "迂棋参谋");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "./");
  assert.match(html, /rel="manifest" href="\.\/manifest\.webmanifest"/);
  assert.match(serviceWorker, /PRECACHE\.push\("\.\/assets\/index-[^"]+\.js"/);

  const assetPaths = [
    ...html.matchAll(/(?:src|href)="\.\/(assets\/[^"?#]+)"/g),
  ].map((match) => match[1]);
  assert.ok(assetPaths.length >= 2);
  await Promise.all(assetPaths.map((path) => access(resolve(mobileDir, path))));

  for (const icon of manifest.icons) {
    await access(resolve(mobileDir, icon.src.replace(/^\.\//, "")));
  }
});

test("mobile icons have the declared PNG dimensions", async () => {
  for (const [file, expected] of [
    ["icon-192.png", 192],
    ["icon-512.png", 512],
  ]) {
    const png = await readFile(resolve(mobileDir, "icons", file));
    assert.equal(png.toString("ascii", 1, 4), "PNG");
    assert.equal(png.readUInt32BE(16), expected);
    assert.equal(png.readUInt32BE(20), expected);
  }
});

test("single-file fallback explains the file protocol limitation", async () => {
  const html = await readFile(
    resolve(projectDir, "outputs", "fanorona-mobile-offline.html"),
    "utf8",
  );
  const head = html.slice(0, html.indexOf("</head>"));
  assert.doesNotMatch(head, /<script[^>]+src=/i);
  assert.doesNotMatch(head, /<link[^>]+rel=["']stylesheet/i);
  assert.match(html, /createObjectURL/);
  assert.match(html, /window\.location\.protocol === "file:"/);
  assert.match(html, /请使用便携版启动/);

  const noscriptEnd = html.indexOf("</noscript>");
  const scriptStart = html.indexOf("<script>", noscriptEnd) + 8;
  const scriptEnd = html.lastIndexOf("</script>");
  assert.ok(scriptStart > 7 && scriptEnd > scriptStart);
  new Function(html.slice(scriptStart, scriptEnd));
});
