import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const launcherDir = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(launcherDir, "..");
const sourceDir = resolve(projectDir, "work", "mobile-pwa");
const webDir = resolve(launcherDir, "web");

await rm(webDir, { recursive: true, force: true });
await mkdir(webDir, { recursive: true });
await cp(sourceDir, webDir, { recursive: true });
