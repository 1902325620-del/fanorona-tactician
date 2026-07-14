import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const wasmUrl = new URL(
  "../app/wasm/generated/morris_engine.wasm",
  import.meta.url,
);
const manifestUrl = new URL(
  "../app/wasm/generated/morris_engine.manifest.json",
  import.meta.url,
);

test("committed Morris Wasm artifact exposes a working ABI", async () => {
  const [bytes, manifestContents] = await Promise.all([
    readFile(wasmUrl),
    readFile(manifestUrl, "utf8"),
  ]);
  const manifest = JSON.parse(manifestContents);
  assert.equal(manifest.manifestVersion, 1);
  assert.equal(manifest.target, "wasm32-unknown-unknown");
  assert.equal(manifest.wasmSize, bytes.length);
  assert.equal(
    manifest.wasmSha256,
    createHash("sha256").update(bytes).digest("hex"),
  );
  assert.match(manifest.normalizedWasmSha256, /^[0-9a-f]{64}$/);
  assert.match(manifest.sourceSha256, /^[0-9a-f]{64}$/);

  const wasmModule = await WebAssembly.compile(bytes);

  assert.deepEqual(WebAssembly.Module.imports(wasmModule), [
    { module: "env", name: "now_ms", kind: "function" },
  ]);

  let now = 0;
  const instance = await WebAssembly.instantiate(wasmModule, {
    env: { now_ms: () => (now += 1) },
  });
  const api = instance.exports;

  assert.equal(api.morris_engine_abi_version(), manifest.abiVersion);
  assert.equal(manifest.abiVersion, 1);

  const handle = api.morris_engine_create(1);
  assert.notEqual(handle, 0);

  try {
    const status = api.morris_engine_search(
      handle,
      0,
      0,
      9,
      9,
      0,
      0,
      50,
      32,
      1,
      1,
      4,
    );
    assert.equal(status, 0);

    const count = api.morris_engine_result_count(handle);
    assert.ok(count >= 1, "the opening search should return a candidate");

    const raw = api.morris_engine_result_move(handle, 0) >>> 0;
    assert.notEqual(raw, 0xffffffff);
    assert.ok((raw & 0x1f) < 24, "placement destination must be on the board");
    assert.equal((raw >>> 5) & 0x1f, 31, "a placement has no source point");
    assert.equal((raw >>> 10) & 0x1f, 31, "the first placement cannot capture");
    assert.equal((raw >>> 15) & 0x3, 0, "the opening move must be a placement");
    assert.equal(raw >>> 17, 0, "reserved move bits must be zero");

    const depth = api.morris_engine_result_depth(handle);
    const nodes =
      (BigInt(api.morris_engine_result_nodes_high(handle) >>> 0) << 32n) |
      BigInt(api.morris_engine_result_nodes_low(handle) >>> 0);
    assert.ok(depth >= 1 && depth <= 22, `unexpected completed depth: ${depth}`);
    assert.ok(nodes > 0n, "the search should visit at least one node");

    assert.equal(api.morris_engine_result_placement_target_depth(handle), 22);
    assert.equal(api.morris_engine_result_placement_complete(handle), 0);
  } finally {
    api.morris_engine_destroy(handle);
  }
});
