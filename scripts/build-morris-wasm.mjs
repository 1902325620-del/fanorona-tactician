import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  copyFile,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const engineDir = path.join(rootDir, "morris-engine");
const target = "wasm32-unknown-unknown";
const outputName = "morris_engine.wasm";
const manifestName = "morris_engine.manifest.json";
const manifestVersion = 1;
const expectedAbiVersion = 1;
const checkOnly = process.argv.slice(2).includes("--check");
const unknownArguments = process.argv
  .slice(2)
  .filter((argument) => argument !== "--check");

if (unknownArguments.length > 0) {
  throw new Error(`Unknown argument(s): ${unknownArguments.join(", ")}`);
}

const cargo = process.env.CARGO?.trim() || "cargo";
const cargoArguments = [
  "rustc",
  "--lib",
  "--release",
  "--target",
  target,
  "--",
  "--crate-type=cdylib",
  // Rust embeds relative panic locations in the data section. Canonicalize
  // Windows separators so semantic Wasm sections match Linux builds.
  "--remap-path-prefix=src\\=src/",
];

const generatedDir = path.join(rootDir, "app", "wasm", "generated");
const generatedWasm = path.join(generatedDir, outputName);
const generatedManifest = path.join(generatedDir, manifestName);

await run(cargo, cargoArguments, engineDir);

const targetDir = process.env.CARGO_TARGET_DIR
  ? path.resolve(engineDir, process.env.CARGO_TARGET_DIR)
  : path.join(engineDir, "target");
const releaseDir = path.join(targetDir, target, "release");
const builtWasm = await findBuiltWasm(releaseDir);

if (checkOnly) {
  await checkCommittedArtifact(builtWasm);
  process.exit(0);
}

await mkdir(generatedDir, { recursive: true });
await copyFile(builtWasm, generatedWasm);

const [contents, sourceSha256] = await Promise.all([
  readFile(generatedWasm),
  sourceFingerprint(),
]);
const artifact = await inspectWasm(contents);
const manifest = {
  manifestVersion,
  target,
  sourceSha256,
  wasmSha256: artifact.sha256,
  normalizedWasmSha256: artifact.normalizedSha256,
  wasmSize: contents.length,
  abiVersion: artifact.abiVersion,
};
await writeFile(generatedManifest, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`[morris-wasm] ${path.relative(rootDir, generatedWasm)}`);
console.log(
  `[morris-wasm] size=${contents.length} bytes sha256=${artifact.sha256} normalized=${artifact.normalizedSha256} source=${sourceSha256}`,
);

async function checkCommittedArtifact(builtWasm) {
  const [builtContents, contents, manifestContents, currentSourceSha256] =
    await Promise.all([
      readFile(builtWasm),
      readFile(generatedWasm),
      readFile(generatedManifest, "utf8"),
      sourceFingerprint(),
    ]);
  const manifest = parseManifest(manifestContents);

  if (manifest.sourceSha256 !== currentSourceSha256) {
    throw new Error(
      "Committed Morris Wasm source fingerprint is stale; run pnpm build:wasm and commit the result",
    );
  }

  const [builtArtifact, artifact] = await Promise.all([
    inspectWasm(builtContents, "freshly built Morris Wasm"),
    inspectWasm(contents, "committed Morris Wasm"),
  ]);
  if (
    manifest.wasmSha256 !== artifact.sha256 ||
    manifest.normalizedWasmSha256 !== artifact.normalizedSha256 ||
    manifest.wasmSize !== contents.length
  ) {
    throw new Error(
      "Committed Morris Wasm does not match its manifest; run pnpm build:wasm and commit both files",
    );
  }
  if (manifest.abiVersion !== artifact.abiVersion) {
    throw new Error(
      `Committed Morris Wasm ABI ${artifact.abiVersion} does not match manifest ABI ${manifest.abiVersion}`,
    );
  }
  if (!builtArtifact.normalized.equals(artifact.normalized)) {
    const difference = firstDifference(
      builtArtifact.normalized,
      artifact.normalized,
    );
    throw new Error(
      [
        "Committed Morris Wasm is stale after removing only non-semantic name/producers custom sections.",
        `fresh raw=${builtArtifact.sha256} normalized=${builtArtifact.normalizedSha256}`,
        `committed raw=${artifact.sha256} normalized=${artifact.normalizedSha256}`,
        `first normalized difference at byte ${difference.offset}: fresh=${difference.left} committed=${difference.right}`,
        "Run pnpm build:wasm and commit the Wasm and manifest.",
      ].join("\n"),
    );
  }

  console.log(
    `[morris-wasm] committed artifact verified (${contents.length} bytes, ABI ${artifact.abiVersion}, source ${currentSourceSha256})`,
  );
  console.log(
    `[morris-wasm] fresh raw=${builtArtifact.sha256} committed raw=${artifact.sha256} normalized=${artifact.normalizedSha256}`,
  );
}

function parseManifest(contents) {
  let manifest;
  try {
    manifest = JSON.parse(contents);
  } catch (error) {
    throw new Error(`Unable to parse ${manifestName}: ${error.message}`, {
      cause: error,
    });
  }

  if (
    manifest?.manifestVersion !== manifestVersion ||
    manifest.target !== target ||
    manifest.abiVersion !== expectedAbiVersion ||
    !Number.isInteger(manifest.wasmSize) ||
    !/^[0-9a-f]{64}$/.test(manifest.sourceSha256 ?? "") ||
    !/^[0-9a-f]{64}$/.test(manifest.wasmSha256 ?? "") ||
    !/^[0-9a-f]{64}$/.test(manifest.normalizedWasmSha256 ?? "")
  ) {
    throw new Error(
      `${manifestName} has an unsupported or malformed format; run pnpm build:wasm`,
    );
  }
  return manifest;
}

async function inspectWasm(contents, label = "Morris Wasm") {
  const sha256 = createHash("sha256").update(contents).digest("hex");
  let wasmModule;
  try {
    wasmModule = await WebAssembly.compile(contents);
  } catch (error) {
    throw new Error(`${label} is invalid: ${error.message}`, {
      cause: error,
    });
  }

  const imports = WebAssembly.Module.imports(wasmModule);
  if (
    imports.length !== 1 ||
    imports[0].module !== "env" ||
    imports[0].name !== "now_ms" ||
    imports[0].kind !== "function"
  ) {
    throw new Error(`${label} has an unexpected import ABI`);
  }

  const instance = await WebAssembly.instantiate(wasmModule, {
    env: { now_ms: () => 0 },
  });
  const abiFunction = instance.exports.morris_engine_abi_version;
  if (typeof abiFunction !== "function") {
    throw new Error(`${label} does not export morris_engine_abi_version`);
  }
  const abiVersion = abiFunction();
  if (abiVersion !== expectedAbiVersion) {
    throw new Error(
      `${label} uses unsupported ABI ${abiVersion}; expected ${expectedAbiVersion}`,
    );
  }
  const normalized = normalizeWasm(contents);
  const normalizedSha256 = createHash("sha256")
    .update(normalized)
    .digest("hex");
  return { sha256, normalizedSha256, normalized, abiVersion };
}

function normalizeWasm(contents) {
  const headerSize = 8;
  if (contents.length < headerSize) {
    throw new Error("Morris Wasm is shorter than its binary header");
  }

  const retained = [contents.subarray(0, headerSize)];
  let offset = headerSize;
  while (offset < contents.length) {
    const sectionStart = offset;
    const sectionId = contents[offset];
    offset += 1;
    const sectionSize = readVarUint32(contents, offset);
    const payloadStart = sectionSize.nextOffset;
    const sectionEnd = payloadStart + sectionSize.value;
    if (sectionEnd > contents.length) {
      throw new Error("Morris Wasm contains a truncated section");
    }

    let ignored = false;
    if (sectionId === 0) {
      const nameSize = readVarUint32(contents, payloadStart, sectionEnd);
      const nameEnd = nameSize.nextOffset + nameSize.value;
      if (nameEnd > sectionEnd) {
        throw new Error("Morris Wasm contains a truncated custom-section name");
      }
      const name = contents.toString("utf8", nameSize.nextOffset, nameEnd);
      ignored = name === "name" || name === "producers";
    }

    if (!ignored) {
      retained.push(contents.subarray(sectionStart, sectionEnd));
    }
    offset = sectionEnd;
  }
  return Buffer.concat(retained);
}

function readVarUint32(contents, offset, limit = contents.length) {
  let value = 0;
  for (let shift = 0; shift <= 28; shift += 7) {
    if (offset >= limit) {
      throw new Error("Morris Wasm contains a truncated unsigned LEB128 value");
    }
    const byte = contents[offset];
    offset += 1;
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) {
      return { value, nextOffset: offset };
    }
  }
  throw new Error("Morris Wasm contains an oversized unsigned LEB128 value");
}

function firstDifference(left, right) {
  const sharedLength = Math.min(left.length, right.length);
  let offset = 0;
  while (offset < sharedLength && left[offset] === right[offset]) {
    offset += 1;
  }
  return {
    offset,
    left: offset < left.length ? formatByte(left[offset]) : "EOF",
    right: offset < right.length ? formatByte(right[offset]) : "EOF",
  };
}

function formatByte(byte) {
  return `0x${byte.toString(16).padStart(2, "0")}`;
}

async function sourceFingerprint() {
  const sourceFiles = [
    path.join(rootDir, "rust-toolchain.toml"),
    path.join(engineDir, "Cargo.toml"),
    path.join(engineDir, "Cargo.lock"),
    ...(await listRustSources(path.join(engineDir, "src"))),
  ].sort((left, right) =>
    portableRelative(left).localeCompare(portableRelative(right), "en"),
  );
  const files = await Promise.all(
    sourceFiles.map(async (sourceFile) => ({
      path: portableRelative(sourceFile),
      // Git may check text out with CRLF on Windows. Rust treats these source
      // newlines equivalently, so canonicalize them before hashing.
      contents: (await readFile(sourceFile, "utf8")).replace(/\r\n?/g, "\n"),
    })),
  );
  const canonicalSource = JSON.stringify({
    fingerprintVersion: 1,
    target,
    cargoArguments,
    files,
  });
  return createHash("sha256").update(canonicalSource).digest("hex");
}

async function listRustSources(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listRustSources(entryPath)));
    } else if (entry.isFile() && entry.name.endsWith(".rs")) {
      files.push(entryPath);
    }
  }
  return files;
}

function portableRelative(file) {
  return path.relative(rootDir, file).replaceAll("\\", "/");
}

async function findBuiltWasm(releaseDir) {
  const direct = path.join(releaseDir, outputName);
  try {
    await access(direct);
    return direct;
  } catch {
    const depsDir = path.join(releaseDir, "deps");
    const candidates = (await readdir(depsDir))
      .filter((name) => /^morris_engine-[0-9a-f]+\.wasm$/i.test(name))
      .sort();
    if (candidates.length === 0) {
      throw new Error(
        "Cargo completed without producing a Morris Wasm artifact",
      );
    }
    const artifacts = await Promise.all(
      candidates.map(async (name) => {
        const artifact = path.join(depsDir, name);
        return { artifact, modified: (await stat(artifact)).mtimeMs };
      }),
    );
    artifacts.sort((a, b) => b.modified - a.modified);
    return artifacts[0].artifact;
  }
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: "inherit",
      shell: process.platform === "win32" && /\.(?:cmd|bat)$/i.test(command),
    });

    child.on("error", (error) => {
      reject(new Error(`Unable to start ${command}: ${error.message}`, { cause: error }));
    });
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const outcome = signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`;
      reject(new Error(`${command} ${args.join(" ")} failed with ${outcome}`));
    });
  });
}
