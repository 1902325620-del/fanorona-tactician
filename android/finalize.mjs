import { copyFile, mkdir, readFile, readdir } from "node:fs/promises";
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
const { version } = JSON.parse(
  await readFile(resolve(projectDir, "package.json"), "utf8"),
);
if (typeof version !== "string" || !/^[0-9A-Za-z.-]+$/.test(version)) {
  throw new Error("package.json contains an invalid release version");
}
await mkdir(outputsDir, { recursive: true });
await Promise.all([
  copyFile(apk, resolve(outputsDir, "fanorona-android.apk")),
  copyFile(apk, resolve(outputsDir, "board-tactician-android.apk")),
  copyFile(
    apk,
    resolve(outputsDir, `board-tactician-android-v${version}.apk`),
  ),
]);
