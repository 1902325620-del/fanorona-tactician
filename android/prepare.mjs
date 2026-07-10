import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const androidDir = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(androidDir, "..");
const sourceDir = resolve(projectDir, "work", "mobile-pwa");
const assetsDir = resolve(androidDir, "Assets");
const mipmapDir = resolve(androidDir, "Resources", "mipmap-hdpi");

await rm(assetsDir, { recursive: true, force: true });
await mkdir(assetsDir, { recursive: true });
await cp(sourceDir, assetsDir, { recursive: true });
await mkdir(mipmapDir, { recursive: true });
await cp(
  resolve(projectDir, "public", "icons", "icon-512.png"),
  resolve(mipmapDir, "appicon.png"),
);
