import {
  EMPTY,
  MORRIS_BOARD_SIZE,
  OPPONENT,
  SELF,
  applyMove,
  generateLegalMoves,
  searchBestMoves,
  type MorrisMove,
  type MorrisPosition,
  type SearchOptions,
  type SearchProgressCallback,
  type SearchResult,
} from "./morris";

const ABI_VERSION = 1;
const DEFAULT_TT_MEGABYTES = 32;
const DEFAULT_PLACEMENT_VERIFICATION_DEPTH = 4;
const INVALID_MOVE = 0xffff_ffff;
const INVALID_SCORE = -0x8000_0000;
const MAX_PV_LENGTH = 128;

const REQUIRED_EXPORTS = {
  morris_engine_abi_version: 0,
  morris_engine_create: 1,
  morris_engine_destroy: 1,
  morris_engine_clear_history: 1,
  morris_engine_push_history: 6,
  morris_engine_search: 12,
  morris_engine_result_count: 1,
  morris_engine_result_move: 2,
  morris_engine_result_candidate_score: 2,
  morris_engine_result_candidate_pv_len: 2,
  morris_engine_result_candidate_pv_move: 3,
  morris_engine_result_score: 1,
  morris_engine_result_depth: 1,
  morris_engine_result_nodes_low: 1,
  morris_engine_result_nodes_high: 1,
  morris_engine_result_nps_low: 1,
  morris_engine_result_nps_high: 1,
  morris_engine_result_completed: 1,
  morris_engine_result_timed_out: 1,
  morris_engine_result_leaves_low: 1,
  morris_engine_result_leaves_high: 1,
  morris_engine_result_symmetry_tt_hits_low: 1,
  morris_engine_result_symmetry_tt_hits_high: 1,
  morris_engine_result_tt_hits_low: 1,
  morris_engine_result_tt_hits_high: 1,
  morris_engine_result_placement_frontier_leaves_low: 1,
  morris_engine_result_placement_frontier_leaves_high: 1,
  morris_engine_result_placement_target_depth: 1,
  morris_engine_result_placement_complete: 1,
} as const;

type NumericFunction = (...arguments_: number[]) => number;

interface MorrisWasmApi {
  morris_engine_abi_version: () => number;
  morris_engine_create: (ttMegabytes: number) => number;
  morris_engine_destroy: (handle: number) => void;
  morris_engine_clear_history: (handle: number) => number;
  morris_engine_push_history: (
    handle: number,
    player0Bits: number,
    player1Bits: number,
    player0Reserve: number,
    player1Reserve: number,
    sideToMove: number,
  ) => number;
  morris_engine_search: (
    handle: number,
    player0Bits: number,
    player1Bits: number,
    player0Reserve: number,
    player1Reserve: number,
    sideToMove: number,
    pliesWithoutCapture: number,
    timeMs: number,
    maxDepth: number,
    topN: number,
    finishPlacement: number,
    placementVerificationDepth: number,
  ) => number;
  morris_engine_result_count: (handle: number) => number;
  morris_engine_result_move: (handle: number, candidate: number) => number;
  morris_engine_result_candidate_score: (handle: number, candidate: number) => number;
  morris_engine_result_candidate_pv_len: (handle: number, candidate: number) => number;
  morris_engine_result_candidate_pv_move: (
    handle: number,
    candidate: number,
    ply: number,
  ) => number;
  morris_engine_result_score: (handle: number) => number;
  morris_engine_result_depth: (handle: number) => number;
  morris_engine_result_nodes_low: (handle: number) => number;
  morris_engine_result_nodes_high: (handle: number) => number;
  morris_engine_result_nps_low: (handle: number) => number;
  morris_engine_result_nps_high: (handle: number) => number;
  morris_engine_result_completed: (handle: number) => number;
  morris_engine_result_timed_out: (handle: number) => number;
  morris_engine_result_leaves_low: (handle: number) => number;
  morris_engine_result_leaves_high: (handle: number) => number;
  morris_engine_result_symmetry_tt_hits_low: (handle: number) => number;
  morris_engine_result_symmetry_tt_hits_high: (handle: number) => number;
  morris_engine_result_tt_hits_low: (handle: number) => number;
  morris_engine_result_tt_hits_high: (handle: number) => number;
  morris_engine_result_placement_frontier_leaves_low: (handle: number) => number;
  morris_engine_result_placement_frontier_leaves_high: (handle: number) => number;
  morris_engine_result_placement_target_depth: (handle: number) => number;
  morris_engine_result_placement_complete: (handle: number) => number;
}

export interface EncodedMorrisPosition {
  readonly player0Bits: number;
  readonly player1Bits: number;
  readonly player0Reserve: number;
  readonly player1Reserve: number;
  readonly sideToMove: 0 | 1;
}

export interface MorrisSearchBackend {
  search(
    position: MorrisPosition,
    options?: SearchOptions,
    onProgress?: SearchProgressCallback,
  ): SearchResult;
  destroy?(): void;
}

export type MorrisSearchFunction = (
  position: MorrisPosition,
  options?: SearchOptions,
  onProgress?: SearchProgressCallback,
) => SearchResult;

interface MorrisWasmEngineOptions {
  readonly now?: () => number;
  readonly ttMegabytes?: number;
}

/** Maps the UI's absolute SELF/OPPONENT identities to ABI player 0/player 1. */
export function encodeMorrisPosition(position: MorrisPosition): EncodedMorrisPosition {
  if (position.board.length !== MORRIS_BOARD_SIZE) {
    throw new RangeError(`Morris board must contain ${MORRIS_BOARD_SIZE} points`);
  }
  const player0Reserve = checkedReserve(position.selfToPlace, "SELF");
  const player1Reserve = checkedReserve(position.opponentToPlace, "OPPONENT");
  let player0Bits = 0;
  let player1Bits = 0;
  let player0Count = 0;
  let player1Count = 0;

  for (let point = 0; point < MORRIS_BOARD_SIZE; point += 1) {
    const cell = position.board[point];
    if (cell === SELF) {
      player0Bits |= 1 << point;
      player0Count += 1;
    } else if (cell === OPPONENT) {
      player1Bits |= 1 << point;
      player1Count += 1;
    } else if (cell !== EMPTY) {
      throw new RangeError(`Invalid Morris cell at point ${point}: ${String(cell)}`);
    }
  }
  if (player0Count + player0Reserve > 9 || player1Count + player1Reserve > 9) {
    throw new RangeError("A Morris player cannot have more than nine total pieces");
  }
  if (position.turn !== SELF && position.turn !== OPPONENT) {
    throw new RangeError(`Invalid Morris side to move: ${String(position.turn)}`);
  }

  return {
    player0Bits: player0Bits >>> 0,
    player1Bits: player1Bits >>> 0,
    player0Reserve,
    player1Reserve,
    sideToMove: position.turn === SELF ? 0 : 1,
  };
}

/** Decodes one ABI move and proves that it is legal in the supplied position. */
export function decodeMorrisWasmMove(rawInput: number, position: MorrisPosition): MorrisMove {
  const raw = readU32(rawInput, "move");
  if (raw === INVALID_MOVE || raw >>> 17 !== 0) {
    throw new Error(`Invalid Morris WASM move: 0x${raw.toString(16)}`);
  }
  const to = raw & 0x1f;
  const fromField = (raw >>> 5) & 0x1f;
  const captureField = (raw >>> 10) & 0x1f;
  const kindField = (raw >>> 15) & 0x3;
  if (
    to >= MORRIS_BOARD_SIZE ||
    (fromField >= MORRIS_BOARD_SIZE && fromField !== 31) ||
    (captureField >= MORRIS_BOARD_SIZE && captureField !== 31)
  ) {
    throw new Error(`Invalid Morris WASM move fields: 0x${raw.toString(16)}`);
  }
  const kind = kindField === 0 ? "place" : kindField === 1 ? "move" : kindField === 2 ? "fly" : null;
  const from = fromField === 31 ? null : fromField;
  const remove = captureField === 31 ? null : captureField;
  if (!kind || (kind === "place") !== (from === null)) {
    throw new Error(`Invalid Morris WASM move kind: 0x${raw.toString(16)}`);
  }

  const matches = generateLegalMoves(position).filter(
    (move) =>
      move.player === position.turn &&
      move.kind === kind &&
      move.from === from &&
      move.to === to &&
      move.remove === remove,
  );
  if (matches.length !== 1) {
    throw new Error(
      `Morris WASM move does not match exactly one legal move: 0x${raw.toString(16)}`,
    );
  }
  return matches[0];
}

export class MorrisWasmEngine implements MorrisSearchBackend {
  private readonly api: MorrisWasmApi;
  private readonly handle: number;
  private readonly now: () => number;
  private destroyed = false;

  constructor(exports: WebAssembly.Exports | Record<string, unknown>, options: MorrisWasmEngineOptions = {}) {
    this.api = validateExports(exports);
    const abiVersion = readU32(this.api.morris_engine_abi_version(), "ABI version");
    if (abiVersion !== ABI_VERSION) {
      throw new Error(`Unsupported Morris WASM ABI version ${abiVersion}; expected ${ABI_VERSION}`);
    }
    const ttMegabytes = clampInteger(
      options.ttMegabytes,
      DEFAULT_TT_MEGABYTES,
      1,
      1_024,
    );
    this.handle = readU32(this.api.morris_engine_create(ttMegabytes), "engine handle");
    if (this.handle === 0) {
      throw new Error(`Morris WASM returned invalid engine handle ${this.handle}`);
    }
    this.now = options.now ?? defaultNow;
  }

  search(
    position: MorrisPosition,
    options: SearchOptions = {},
    onProgress?: SearchProgressCallback,
  ): SearchResult {
    this.assertActive();
    const root = encodeMorrisPosition(position);
    const timeMs = clampInteger(options.timeMs, 1_500, 1, 60_000);
    const maxDepth = clampInteger(options.maxDepth, 8, 1, 126);
    const topN = clampInteger(options.topN, 3, 1, 3);
    const startedAt = this.now();

    expectStatus(
      this.api.morris_engine_clear_history(this.handle),
      "morris_engine_clear_history",
    );
    for (const historical of options.history ?? []) {
      const encoded = encodeMorrisPosition(historical);
      expectStatus(
        this.api.morris_engine_push_history(
          this.handle,
          encoded.player0Bits,
          encoded.player1Bits,
          encoded.player0Reserve,
          encoded.player1Reserve,
          encoded.sideToMove,
        ),
        "morris_engine_push_history",
      );
    }

    // The current TS state has no no-capture counter because the standard app
    // rules do not enable that optional draw condition. Repetition history is
    // still transferred exactly through the dedicated ABI calls above.
    expectStatus(
      this.api.morris_engine_search(
        this.handle,
        root.player0Bits,
        root.player1Bits,
        root.player0Reserve,
        root.player1Reserve,
        root.sideToMove,
        0,
        timeMs,
        maxDepth,
        topN,
        1,
        DEFAULT_PLACEMENT_VERIFICATION_DEPTH,
      ),
      "morris_engine_search",
    );

    const count = readU32(this.api.morris_engine_result_count(this.handle), "result count");
    if (count > topN || count > 3) {
      throw new Error(`Morris WASM returned ${count} candidates for topN=${topN}`);
    }
    const topMoves = [];
    const seenMoves = new Set<string>();
    for (let candidate = 0; candidate < count; candidate += 1) {
      const rootRaw = readU32(
        this.api.morris_engine_result_move(this.handle, candidate),
        `candidate ${candidate} move`,
      );
      const move = decodeMorrisWasmMove(rootRaw, position);
      if (seenMoves.has(move.id)) {
        throw new Error(`Morris WASM returned duplicate candidate ${move.id}`);
      }
      seenMoves.add(move.id);
      const score = readScore(
        this.api.morris_engine_result_candidate_score(this.handle, candidate),
        `candidate ${candidate} score`,
      );
      const pvLength = readU32(
        this.api.morris_engine_result_candidate_pv_len(this.handle, candidate),
        `candidate ${candidate} PV length`,
      );
      if (pvLength < 1 || pvLength > MAX_PV_LENGTH) {
        throw new Error(`Morris WASM returned invalid PV length ${pvLength}`);
      }
      const pv: MorrisMove[] = [];
      let pvPosition = position;
      for (let ply = 0; ply < pvLength; ply += 1) {
        const raw = readU32(
          this.api.morris_engine_result_candidate_pv_move(this.handle, candidate, ply),
          `candidate ${candidate} PV ply ${ply}`,
        );
        const pvMove = decodeMorrisWasmMove(raw, pvPosition);
        pv.push(pvMove);
        pvPosition = applyMove(pvPosition, pvMove);
      }
      if (pv[0].id !== move.id) {
        throw new Error(`Morris WASM candidate ${candidate} does not match its PV root`);
      }
      topMoves.push({ move, score, pv });
    }
    for (let index = 1; index < topMoves.length; index += 1) {
      if (topMoves[index - 1].score < topMoves[index].score) {
        throw new Error("Morris WASM candidates are not sorted by descending score");
      }
    }

    const score = readScore(this.api.morris_engine_result_score(this.handle), "result score");
    const depth = readU32(this.api.morris_engine_result_depth(this.handle), "result depth");
    const nodes = readU64AsNumber(
      this.api.morris_engine_result_nodes_low(this.handle),
      this.api.morris_engine_result_nodes_high(this.handle),
      "result nodes",
    );
    const nps = readU64AsNumber(
      this.api.morris_engine_result_nps_low(this.handle),
      this.api.morris_engine_result_nps_high(this.handle),
      "result NPS",
    );
    const completed = readBoolean(
      this.api.morris_engine_result_completed(this.handle),
      "result completed",
    );
    const timedOut = readBoolean(
      this.api.morris_engine_result_timed_out(this.handle),
      "result timed out",
    );
    // Validate the remaining ABI getters even though the current worker
    // protocol intentionally exposes only its established progress fields.
    readU64AsNumber(
      this.api.morris_engine_result_leaves_low(this.handle),
      this.api.morris_engine_result_leaves_high(this.handle),
      "result leaves",
    );
    readU64AsNumber(
      this.api.morris_engine_result_symmetry_tt_hits_low(this.handle),
      this.api.morris_engine_result_symmetry_tt_hits_high(this.handle),
      "result symmetry TT hits",
    );
    readU64AsNumber(
      this.api.morris_engine_result_tt_hits_low(this.handle),
      this.api.morris_engine_result_tt_hits_high(this.handle),
      "result TT hits",
    );
    readU64AsNumber(
      this.api.morris_engine_result_placement_frontier_leaves_low(this.handle),
      this.api.morris_engine_result_placement_frontier_leaves_high(this.handle),
      "result placement frontier leaves",
    );
    const placementTargetDepth = readU32(
      this.api.morris_engine_result_placement_target_depth(this.handle),
      "result placement target depth",
    );
    const placementComplete = readBoolean(
      this.api.morris_engine_result_placement_complete(this.handle),
      "result placement complete",
    );

    const finishedAt = this.now();
    const elapsed = Number.isFinite(startedAt) && Number.isFinite(finishedAt)
      ? Math.max(0, finishedAt - startedAt)
      : 0;
    const progress = {
      depth,
      nodes,
      timeMs: elapsed,
      nps,
      score,
      pv: topMoves[0]?.pv ?? [],
      topMoves,
      engine: "wasm" as const,
      placementTargetDepth,
      placementComplete,
    };
    onProgress?.(progress);
    return {
      ...progress,
      bestMove: topMoves[0]?.move ?? null,
      completed,
      timedOut,
    };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.api.morris_engine_destroy(this.handle);
  }

  private assertActive(): void {
    if (this.destroyed) throw new Error("Morris WASM engine has been destroyed");
  }
}

/** Worker-level routing: any WASM failure permanently selects the TS engine. */
export class MorrisSearchRouter {
  private readonly backendPromise: Promise<MorrisSearchBackend | null>;
  private disabled = false;

  constructor(
    loadBackend: () => MorrisSearchBackend | Promise<MorrisSearchBackend>,
    private readonly fallback: MorrisSearchFunction = searchBestMoves,
  ) {
    try {
      this.backendPromise = Promise.resolve(loadBackend()).catch(() => {
        this.disabled = true;
        return null;
      });
    } catch {
      this.disabled = true;
      this.backendPromise = Promise.resolve(null);
    }
  }

  async search(
    position: MorrisPosition,
    options: SearchOptions = {},
    onProgress?: SearchProgressCallback,
  ): Promise<SearchResult> {
    const backend = await this.backendPromise;
    if (!this.disabled && backend && !options.shouldStop?.()) {
      try {
        return backend.search(position, options, onProgress);
      } catch {
        this.disabled = true;
        try {
          backend.destroy?.();
        } catch {
          // The worker is already abandoning this backend permanently.
        }
      }
    }
    const result = this.fallback(position, options, onProgress);
    return { ...result, engine: "typescript" };
  }
}

function validateExports(exports: WebAssembly.Exports | Record<string, unknown>): MorrisWasmApi {
  const record = exports as Record<string, unknown>;
  for (const [name, arity] of Object.entries(REQUIRED_EXPORTS)) {
    const candidate = record[name];
    if (typeof candidate !== "function") {
      throw new Error(`Morris WASM is missing required export ${name}`);
    }
    if ((candidate as NumericFunction).length !== arity) {
      throw new Error(
        `Morris WASM export ${name} has arity ${(candidate as NumericFunction).length}; expected ${arity}`,
      );
    }
  }
  return record as unknown as MorrisWasmApi;
}

function checkedReserve(value: number, player: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 9) {
    throw new RangeError(`Invalid ${player} reserve: ${String(value)}`);
  }
  return value;
}

function expectStatus(value: number, operation: string): void {
  const status = readI32(value, `${operation} status`);
  if (status !== 0) throw new Error(`${operation} failed with status ${status}`);
}

function readScore(value: number, label: string): number {
  const score = readI32(value, label);
  if (score === INVALID_SCORE) throw new Error(`${label} is unavailable`);
  return score;
}

function readBoolean(value: number, label: string): boolean {
  const normalized = readU32(value, label);
  if (normalized !== 0 && normalized !== 1) {
    throw new Error(`${label} must be 0 or 1; received ${normalized}`);
  }
  return normalized === 1;
}

function readU64AsNumber(lowValue: number, highValue: number, label: string): number {
  const low = readU32(lowValue, `${label} low`);
  const high = readU32(highValue, `${label} high`);
  const combined = (BigInt(high) << BigInt(32)) | BigInt(low);
  if (combined > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${label} exceeds JavaScript's exact integer range`);
  }
  return Number(combined);
}

function readU32(value: number, label: string): number {
  if (
    !Number.isInteger(value) ||
    value < -0x8000_0000 ||
    value > 0xffff_ffff
  ) {
    throw new Error(`${label} is not an i32/u32 value: ${String(value)}`);
  }
  return value >>> 0;
}

function readI32(value: number, label: string): number {
  if (!Number.isInteger(value) || value < -0x8000_0000 || value > 0x7fff_ffff) {
    throw new Error(`${label} is not an i32 value: ${String(value)}`);
  }
  return value | 0;
}

function clampInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(value!)));
}

function defaultNow(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}
