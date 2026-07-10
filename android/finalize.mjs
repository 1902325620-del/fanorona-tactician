import { copyFile, mkdir, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const androidDir = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(androidDir, "..");
const searchRoot = resolve(androidDir, "bin", "Release", "net10.0-android");
const outputsDir = resolve(projectDir, "outputs");

async function findSignedApk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await findSignedApk(fullPath);
      if (nested) return nested;
    } else if (entry.name.toLowerCase().endsWith("-signed.apk")) {
      return fullPath;
    }
  }
  return null;
}

const apk = await findSignedApk(searchRoot);
if (!apk) throw new Error("Signed Android APK was not produced");
await mkdir(outputsDir, { recursive: true });
await copyFile(apk, resolve(outputsDir, "fanorona-android.apk"));
