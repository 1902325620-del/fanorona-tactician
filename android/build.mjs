import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const androidDir = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(androidDir, "..");
const project = resolve(androidDir, "FanoronaAndroid.csproj");
const sdk = resolve(projectDir, "work", "android-sdk");
const jdk = resolve(projectDir, "work", "jdk");
const signingDir = resolve(projectDir, "work", "android-signing");
const keyStore = resolve(signingDir, "fanorona.keystore");
const passwordFile = resolve(signingDir, "password.txt");

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: projectDir,
    stdio: "inherit",
    shell: false,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (!(await exists(resolve(sdk, "platforms"))) || !(await exists(resolve(jdk, "bin")))) {
  run("dotnet", [
    "build",
    project,
    "-t:InstallAndroidDependencies",
    "-f",
    "net10.0-android",
    `-p:AndroidSdkDirectory=${sdk}`,
    `-p:JavaSdkDirectory=${jdk}`,
    "-p:AcceptAndroidSDKLicenses=True",
  ]);
}

await mkdir(signingDir, { recursive: true });
let signingPassword;
if (await exists(passwordFile)) {
  signingPassword = (await readFile(passwordFile, "utf8")).trim();
} else {
  signingPassword = randomBytes(24).toString("base64url");
  await writeFile(passwordFile, signingPassword, "utf8");
}

if (!(await exists(keyStore))) {
  run(resolve(jdk, "bin", "keytool.exe"), [
    "-genkeypair",
    "-keystore",
    keyStore,
    "-storetype",
    "PKCS12",
    "-storepass",
    signingPassword,
    "-keypass",
    signingPassword,
    "-alias",
    "fanorona",
    "-keyalg",
    "RSA",
    "-keysize",
    "2048",
    "-validity",
    "10000",
    "-dname",
    "CN=Fanorona Tactician, O=Local Build, C=CN",
  ]);
}

run("dotnet", [
  "build",
  project,
  "-c",
  "Release",
  "-f",
  "net10.0-android",
  "-p:AndroidPackageFormat=apk",
  "-p:AndroidKeyStore=true",
  `-p:AndroidSigningKeyStore=${keyStore}`,
  `-p:AndroidSigningStorePass=${signingPassword}`,
  "-p:AndroidSigningKeyAlias=fanorona",
  `-p:AndroidSigningKeyPass=${signingPassword}`,
  `-p:AndroidSdkDirectory=${sdk}`,
  `-p:JavaSdkDirectory=${jdk}`,
]);
