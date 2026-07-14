import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, copyFile, mkdir, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const engineDir = path.join(rootDir, "morris-engine");
const target = "wasm32-unknown-unknown";
const outputName = "morris_engine.wasm";
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
];

await run(cargo, cargoArguments, engineDir);

const targetDir = process.env.CARGO_TARGET_DIR
  ? path.resolve(engineDir, process.env.CARGO_TARGET_DIR)
  : path.join(engineDir, "target");
const releaseDir = path.join(targetDir, target, "release");
const builtWasm = await findBuiltWasm(releaseDir);
const generatedDir = path.join(rootDir, "app", "wasm", "generated");
const generatedWasm = path.join(generatedDir, outputName);

if (checkOnly) {
  const [built, generated] = await Promise.all([
    readFile(builtWasm),
    readFile(generatedWasm),
  ]);
  if (!built.equals(generated)) {
    throw new Error(
      "Committed Morris Wasm is stale; run pnpm build:wasm and commit the result",
    );
  }
  console.log(`[morris-wasm] staged artifact matches Rust source (${built.length} bytes)`);
  process.exit(0);
}

await mkdir(generatedDir, { recursive: true });
await copyFile(builtWasm, generatedWasm);

const [contents, metadata] = await Promise.all([
  readFile(generatedWasm),
  stat(generatedWasm),
]);
const sha256 = createHash("sha256").update(contents).digest("hex");

console.log(`[morris-wasm] ${path.relative(rootDir, generatedWasm)}`);
console.log(`[morris-wasm] size=${metadata.size} bytes sha256=${sha256}`);

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
