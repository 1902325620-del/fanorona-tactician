import assert from "node:assert/strict";
import test from "node:test";
import {
  ADJACENCY,
  EMPTY,
  MILLS,
  MORRIS_AUTOMORPHISMS,
  OPPONENT,
  SELF,
  algebraicToIndex,
  applyMove,
  countMills,
  createInitialPosition,
  evaluatePosition,
  generateLegalMoves,
  getGameStatus,
  getPhase,
  getRemovablePieces,
  indexToAlgebraic,
  searchBestMoves,
  type MorrisCell,
  type MorrisPosition,
  type Player,
} from "../app/lib/morris";
import {
  MorrisSearchRouter,
  MorrisWasmEngine,
  decodeMorrisWasmMove,
  encodeMorrisPosition,
} from "../app/lib/morris-wasm";

function positionWith(
  entries: Array<[string, MorrisCell]>,
  turn: Player = SELF,
  selfToPlace = 0,
  opponentToPlace = 0,
): MorrisPosition {
  const board = Array<MorrisCell>(24).fill(EMPTY);
  for (const [point, piece] of entries) board[algebraicToIndex(point)] = piece;
  return { board, turn, selfToPlace, opponentToPlace };
}

test("standard board exposes stable Morris coordinates", () => {
  assert.equal(indexToAlgebraic(0), "a7");
  assert.equal(indexToAlgebraic(23), "g1");
  assert.equal(algebraicToIndex("D5"), 7);
  assert.throws(() => algebraicToIndex("d4"), RangeError);
});

test("all sixteen board automorphisms preserve edges and mills", () => {
  assert.equal(MORRIS_AUTOMORPHISMS.length, 16);
  assert.equal(
    new Set(MORRIS_AUTOMORPHISMS.map((mapping) => mapping.join(","))).size,
    16,
  );
  const millKeys = new Set(
    MILLS.map((mill) => [...mill].sort((a, b) => a - b).join(",")),
  );

  for (const mapping of MORRIS_AUTOMORPHISMS) {
    assert.deepEqual(
      [...mapping].sort((a, b) => a - b),
      Array.from({ length: 24 }, (_, index) => index),
    );
    for (let from = 0; from < ADJACENCY.length; from += 1) {
      for (const to of ADJACENCY[from]) {
        assert.ok(ADJACENCY[mapping[from]].includes(mapping[to]));
      }
    }
    for (const mill of MILLS) {
      const transformed = mill
        .map((point) => mapping[point])
        .sort((a, b) => a - b)
        .join(",");
      assert.ok(millKeys.has(transformed));
    }
  }
});

test("initial position contains two reserves of nine and 24 placements", () => {
  const position = createInitialPosition(SELF);
  assert.equal(position.selfToPlace, 9);
  assert.equal(position.opponentToPlace, 9);
  assert.equal(getPhase(position), "placing");
  assert.equal(generateLegalMoves(position).length, 24);
});

test("placement returns a new state and leaves its source immutable", () => {
  const initial = createInitialPosition(SELF);
  const move = generateLegalMoves(initial).find((candidate) => candidate.notation === "@a7");
  assert.ok(move);
  const next = applyMove(initial, move);
  assert.equal(initial.board[0], EMPTY);
  assert.equal(initial.selfToPlace, 9);
  assert.equal(next.board[0], SELF);
  assert.equal(next.selfToPlace, 8);
  assert.equal(next.turn, OPPONENT);
});

test("closing a mill expands the action into exactly one legal removal", () => {
  const position = positionWith(
    [
      ["a7", SELF],
      ["d7", SELF],
      ["a1", OPPONENT],
      ["d1", OPPONENT],
    ],
    SELF,
    1,
    0,
  );
  const completions = generateLegalMoves(position).filter(
    (move) => move.to === algebraicToIndex("g7"),
  );
  assert.equal(completions.length, 2);
  assert.ok(completions.every((move) => move.formsMill && move.remove !== null));
  assert.deepEqual(
    completions.map((move) => indexToAlgebraic(move.remove!)).sort(),
    ["a1", "d1"],
  );
});

test("a protected mill piece cannot be removed while an exposed piece exists", () => {
  const boardPosition = positionWith([
    ["a7", OPPONENT],
    ["d7", OPPONENT],
    ["g7", OPPONENT],
    ["b6", OPPONENT],
    ["a1", SELF],
    ["d1", SELF],
    ["g1", SELF],
  ]);
  assert.deepEqual(
    getRemovablePieces(boardPosition, SELF).map(indexToAlgebraic),
    ["b6"],
  );
});

test("mill pieces become removable when every opposing piece is in a mill", () => {
  const boardPosition = positionWith([
    ["a7", OPPONENT],
    ["d7", OPPONENT],
    ["g7", OPPONENT],
    ["a1", SELF],
    ["d1", SELF],
    ["g1", SELF],
  ]);
  assert.deepEqual(
    getRemovablePieces(boardPosition, SELF).map(indexToAlgebraic),
    ["a7", "d7", "g7"],
  );
});

test("movement follows board edges and cannot jump with more than three men", () => {
  const position = positionWith([
    ["a7", SELF],
    ["d6", SELF],
    ["g4", SELF],
    ["a1", SELF],
    ["g7", OPPONENT],
    ["b6", OPPONENT],
    ["c5", OPPONENT],
    ["g1", OPPONENT],
  ]);
  assert.equal(getPhase(position), "moving");
  const fromA7 = generateLegalMoves(position).filter(
    (move) => move.from === algebraicToIndex("a7"),
  );
  assert.deepEqual(fromA7.map((move) => move.notation).sort(), ["a7-a4", "a7-d7"]);
  assert.ok(fromA7.every((move) => move.kind === "move"));
});

test("a player with exactly three men may fly to any empty point", () => {
  const position = positionWith([
    ["a7", SELF],
    ["d7", SELF],
    ["a1", SELF],
    ["g7", OPPONENT],
    ["g4", OPPONENT],
    ["g1", OPPONENT],
  ]);
  assert.equal(getPhase(position), "flying");
  const longFlight = generateLegalMoves(position).find(
    (move) => move.from === algebraicToIndex("a7") && move.to === algebraicToIndex("f6"),
  );
  assert.ok(longFlight);
  assert.equal(longFlight.kind, "fly");
});

test("flying is disabled during placement even with three board pieces", () => {
  const position = positionWith(
    [
      ["a7", SELF],
      ["d7", SELF],
      ["a1", SELF],
    ],
    SELF,
    1,
    0,
  );
  assert.equal(getPhase(position), "placing");
  assert.ok(generateLegalMoves(position).every((move) => move.kind === "place"));
});

test("removal and movement are applied as one complete turn", () => {
  const position = positionWith([
    ["a7", SELF],
    ["d7", SELF],
    ["g4", SELF],
    ["a1", SELF],
    ["g7", OPPONENT],
    ["b6", OPPONENT],
    ["c5", OPPONENT],
    ["g1", OPPONENT],
  ]);
  const move = generateLegalMoves(position).find(
    (candidate) =>
      candidate.from === algebraicToIndex("g4") &&
      candidate.to === algebraicToIndex("g7") &&
      candidate.remove === algebraicToIndex("b6"),
  );
  // g4-g7 is not an edge: illegal actions never appear.
  assert.equal(move, undefined);

  const millPosition = positionWith([
    ["a7", SELF],
    ["d7", SELF],
    ["g4", SELF],
    ["a1", SELF],
    ["b6", OPPONENT],
    ["c5", OPPONENT],
    ["e3", OPPONENT],
    ["g1", OPPONENT],
  ]);
  const legal = generateLegalMoves(millPosition).find(
    (candidate) =>
      candidate.from === algebraicToIndex("g4") &&
      candidate.to === algebraicToIndex("g7") &&
      candidate.remove === algebraicToIndex("b6"),
  );
  assert.ok(legal);
  const next = applyMove(millPosition, legal);
  assert.equal(next.board[algebraicToIndex("g4")], EMPTY);
  assert.equal(next.board[algebraicToIndex("g7")], SELF);
  assert.equal(next.board[algebraicToIndex("b6")], EMPTY);
  assert.equal(next.turn, OPPONENT);
});

test("a player below three loses only after both placements finish", () => {
  const finished = positionWith([
    ["a7", SELF],
    ["d7", SELF],
    ["g7", OPPONENT],
    ["g4", OPPONENT],
    ["g1", OPPONENT],
  ]);
  assert.deepEqual(getGameStatus(finished).state, "won");
  assert.equal(getGameStatus(finished).winner, OPPONENT);
  assert.equal(getGameStatus(finished).reason, "fewer-than-three");

  const stillPlacing = { ...finished, selfToPlace: 1 };
  assert.equal(getGameStatus(stillPlacing).state, "playing");
});

test("a blocked player with at least three men loses by immobilization", () => {
  const position = positionWith([
    ["a7", SELF],
    ["g7", SELF],
    ["a1", SELF],
    ["g1", SELF],
    ["d7", OPPONENT],
    ["a4", OPPONENT],
    ["g4", OPPONENT],
    ["d1", OPPONENT],
  ]);
  const status = getGameStatus(position);
  assert.equal(status.state, "won");
  assert.equal(status.winner, OPPONENT);
  assert.equal(status.reason, "immobilization");
});

test("double mills still grant exactly one removal per turn", () => {
  const position = positionWith(
    [
      ["a7", SELF],
      ["g7", SELF],
      ["d6", SELF],
      ["d5", SELF],
      ["a1", OPPONENT],
      ["g1", OPPONENT],
    ],
    SELF,
    1,
    0,
  );
  const moves = generateLegalMoves(position).filter(
    (move) => move.to === algebraicToIndex("d7"),
  );
  assert.equal(countMills(applyMove(position, moves[0]), SELF), 2);
  assert.ok(moves.length === 2 && moves.every((move) => move.remove !== null));
});

test("illegal or incomplete mill actions are rejected", () => {
  const position = positionWith(
    [
      ["a7", SELF],
      ["d7", SELF],
      ["a1", OPPONENT],
    ],
    SELF,
    1,
    0,
  );
  const legal = generateLegalMoves(position).find((move) => move.to === algebraicToIndex("g7"));
  assert.ok(legal);
  assert.throws(
    () => applyMove(position, { ...legal, id: `${legal.id}:tampered`, remove: null }),
    RangeError,
  );
});

test("search returns ranked legal choices and reports completed progress", () => {
  const position = positionWith(
    [
      ["a7", SELF],
      ["d7", SELF],
      ["a1", OPPONENT],
      ["d1", OPPONENT],
    ],
    SELF,
    1,
    0,
  );
  const updates: number[] = [];
  const result = searchBestMoves(
    position,
    { timeMs: 500, maxDepth: 2, topN: 3 },
    (progress) => updates.push(progress.depth),
  );
  assert.ok(result.bestMove);
  assert.ok(generateLegalMoves(position).some((move) => move.id === result.bestMove?.id));
  assert.ok(result.topMoves.length > 0 && result.topMoves.length <= 3);
  assert.ok(result.topMoves.every((line, index, lines) => index === 0 || lines[index - 1].score >= line.score));
  assert.ok(updates.includes(1));
});

test("cooperative cancellation returns a legal fallback without mutating state", () => {
  const position = createInitialPosition(SELF);
  const snapshot = JSON.stringify(position);
  const result = searchBestMoves(position, {
    timeMs: 1000,
    maxDepth: 5,
    shouldStop: () => true,
  });
  assert.ok(result.bestMove);
  assert.equal(result.completed, false);
  assert.equal(JSON.stringify(position), snapshot);
});

test("the flying-mobility regression position no longer rewards losing a piece", () => {
  const fourPieces = positionWith([
    ["b2", SELF],
    ["g1", SELF],
    ["g4", SELF],
    ["g7", SELF],
    ["a1", OPPONENT],
    ["d1", OPPONENT],
    ["d7", OPPONENT],
    ["f4", OPPONENT],
  ]);
  const threePieces = positionWith([
    ["g1", SELF],
    ["g4", SELF],
    ["g7", SELF],
    ["a1", OPPONENT],
    ["d1", OPPONENT],
    ["d7", OPPONENT],
    ["f4", OPPONENT],
  ]);

  assert.ok(
    evaluatePosition(threePieces, SELF) < evaluatePosition(fourPieces, SELF),
  );
});

test("search defends the verified second-player placement tactic", () => {
  const position = positionWith(
    [
      ["d7", SELF],
      ["b6", SELF],
      ["e5", SELF],
      ["b4", SELF],
      ["f4", SELF],
      ["b2", SELF],
      ["g7", OPPONENT],
      ["e4", OPPONENT],
      ["g4", OPPONENT],
      ["e3", OPPONENT],
      ["d2", OPPONENT],
      ["a1", OPPONENT],
      ["d1", OPPONENT],
      ["g1", OPPONENT],
    ],
    SELF,
    1,
    0,
  );
  const result = searchBestMoves(position, {
    timeMs: 1_000,
    maxDepth: 5,
    topN: 1,
  });

  assert.equal(result.depth, 5);
  assert.equal(result.bestMove?.notation, "@d6");
});

test("evaluation and search remain neutral when player colors are swapped", () => {
  const original = positionWith(
    [
      ["a7", SELF],
      ["d6", SELF],
      ["c4", SELF],
      ["g1", OPPONENT],
      ["f4", OPPONENT],
      ["d2", OPPONENT],
    ],
    SELF,
    3,
    3,
  );
  const swapped: MorrisPosition = {
    board: original.board.map((cell) =>
      cell === SELF ? OPPONENT : cell === OPPONENT ? SELF : EMPTY,
    ),
    turn: OPPONENT,
    selfToPlace: original.opponentToPlace,
    opponentToPlace: original.selfToPlace,
  };

  assert.equal(
    evaluatePosition(original, SELF),
    evaluatePosition(swapped, OPPONENT),
  );
  const originalSearch = searchBestMoves(original, {
    timeMs: 1_000,
    maxDepth: 3,
    topN: 1,
  });
  const swappedSearch = searchBestMoves(swapped, {
    timeMs: 1_000,
    maxDepth: 3,
    topN: 1,
  });
  assert.equal(originalSearch.score, swappedSearch.score);
  assert.equal(originalSearch.bestMove?.notation, swappedSearch.bestMove?.notation);
});

test("placement evaluation rewards real empty adjacency rather than raw point degree", () => {
  const centralAgainstCorner = positionWith(
    [
      ["d7", SELF],
      ["a1", OPPONENT],
    ],
    SELF,
    8,
    8,
  );
  const reproducedGameRoot = positionWith(
    [
      ["a7", SELF],
      ["d6", OPPONENT],
      ["d2", OPPONENT],
    ],
    SELF,
    8,
    7,
  );

  assert.equal(evaluatePosition(centralAgainstCorner, SELF), 100);
  assert.equal(evaluatePosition(reproducedGameRoot, SELF), -600);
  assert.equal(evaluatePosition(reproducedGameRoot, OPPONENT), 600);
});

test("real-game history lets search avoid a third occurrence when alternatives exist", () => {
  const position = positionWith([
    ["a7", SELF],
    ["d6", SELF],
    ["c4", SELF],
    ["g1", SELF],
    ["g7", OPPONENT],
    ["b6", OPPONENT],
    ["e4", OPPONENT],
    ["d1", OPPONENT],
  ]);
  const baseline = searchBestMoves(position, {
    timeMs: 1_000,
    maxDepth: 1,
    topN: 1,
    tacticalDepth: 0,
  });
  assert.ok(baseline.bestMove);
  const repeatedChild = applyMove(position, baseline.bestMove);
  const withHistory = searchBestMoves(position, {
    timeMs: 1_000,
    maxDepth: 1,
    topN: 1,
    tacticalDepth: 0,
    history: [repeatedChild, repeatedChild],
    drawScore: -10_000,
  });

  assert.ok(withHistory.bestMove);
  assert.notEqual(withHistory.bestMove.id, baseline.bestMove.id);
});

test("transposition entries keep direction-specific repetition history separate", () => {
  const position = positionWith([
    ["a7", SELF],
    ["g7", SELF],
    ["a1", SELF],
    ["g1", SELF],
    ["b6", OPPONENT],
    ["f6", OPPONENT],
    ["b2", OPPONENT],
    ["f2", OPPONENT],
  ]);
  const first = generateLegalMoves(position).find(
    (move) => move.notation === "a7-a4",
  );
  assert.ok(first);
  const afterFirst = applyMove(position, first);
  const second = generateLegalMoves(afterFirst).find(
    (move) => move.notation === "f6-d6",
  );
  assert.ok(second);
  const repeated = applyMove(afterFirst, second);
  const result = searchBestMoves(position, {
    timeMs: 2_000,
    maxDepth: 2,
    topN: 100,
    tacticalDepth: 0,
    history: [repeated, repeated],
    drawScore: -10_000,
  });
  const repeatedLine = result.topMoves.find(
    (line) => line.move.notation === "a7-a4",
  );

  assert.equal(repeatedLine?.score, -10_000);
  assert.notEqual(result.bestMove?.notation, "a7-a4");
});

test("WASM position and move adapters preserve absolute player identities", () => {
  const position = positionWith(
    [
      ["g1", SELF],
      ["d1", OPPONENT],
    ],
    OPPONENT,
    2,
    3,
  );
  assert.deepEqual(encodeMorrisPosition(position), {
    player0Bits: 1 << algebraicToIndex("g1"),
    player1Bits: 1 << algebraicToIndex("d1"),
    player0Reserve: 2,
    player1Reserve: 3,
    sideToMove: 1,
  });

  const millPosition = positionWith(
    [
      ["a7", SELF],
      ["d7", SELF],
      ["a1", OPPONENT],
      ["d1", OPPONENT],
    ],
    SELF,
    1,
    0,
  );
  const raw = encodeRawMove(0, null, algebraicToIndex("g7"), algebraicToIndex("a1"));
  assert.equal(decodeMorrisWasmMove(raw, millPosition).notation, "@g7xa1");
});

test("WASM adapter validates ABI, transfers history, and decodes a legal PV", () => {
  const root = createInitialPosition(SELF);
  const history = createInitialPosition(OPPONENT);
  const first = encodeRawMove(0, null, algebraicToIndex("a7"), null);
  const second = encodeRawMove(0, null, algebraicToIndex("d7"), null);
  const historyCalls: number[][] = [];
  const searchCalls: number[][] = [];
  const destroyCalls: number[] = [];
  let clockIndex = 0;
  const engine = new MorrisWasmEngine(
    makeFakeWasmExports({
      morris_engine_destroy(handle: number) {
        destroyCalls.push(handle);
      },
      morris_engine_push_history(
        handle: number,
        player0Bits: number,
        player1Bits: number,
        player0Reserve: number,
        player1Reserve: number,
        sideToMove: number,
      ) {
        historyCalls.push([
          handle,
          player0Bits,
          player1Bits,
          player0Reserve,
          player1Reserve,
          sideToMove,
        ]);
        return 0;
      },
      morris_engine_search(
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
      ) {
        searchCalls.push([
          handle,
          player0Bits,
          player1Bits,
          player0Reserve,
          player1Reserve,
          sideToMove,
          pliesWithoutCapture,
          timeMs,
          maxDepth,
          topN,
          finishPlacement,
          placementVerificationDepth,
        ]);
        return 0;
      },
      morris_engine_result_move: wasmConstant(2, first),
      morris_engine_result_candidate_pv_len: wasmConstant(2, 2),
      morris_engine_result_candidate_pv_move: (
        handle: number,
        candidate: number,
        ply: number,
      ) => {
        assert.equal(handle, FAKE_ENGINE_HANDLE);
        void candidate;
        return ply === 0 ? first : second;
      },
    }),
    { now: () => [10, 25][clockIndex++] },
  );
  const updates: number[] = [];
  const result = engine.search(
    root,
    { history: [history], timeMs: 500, maxDepth: 2, topN: 1 },
    (progress) => updates.push(progress.depth),
  );

  assert.deepEqual(historyCalls, [[FAKE_ENGINE_HANDLE, 0, 0, 9, 9, 1]]);
  assert.deepEqual(searchCalls, [[FAKE_ENGINE_HANDLE, 0, 0, 9, 9, 0, 0, 500, 2, 1, 1, 4]]);
  assert.equal(result.bestMove?.notation, "@a7");
  assert.deepEqual(result.pv.map((move) => move.notation), ["@a7", "@d7"]);
  assert.equal(result.score, 42);
  assert.equal(result.nodes, 10);
  assert.equal(result.nps, 20);
  assert.equal(result.timeMs, 15);
  assert.deepEqual(updates, [3]);
  engine.destroy();
  assert.deepEqual(destroyCalls, [FAKE_ENGINE_HANDLE]);
  assert.throws(() => engine.search(root), /destroyed/);
});

test("WASM adapter rejects missing, incompatible, and illegal ABI results", () => {
  assert.throws(
    () => new MorrisWasmEngine(makeFakeWasmExports({ morris_engine_abi_version: () => 2 })),
    /ABI version 2/,
  );
  const missing = makeFakeWasmExports();
  delete missing.morris_engine_result_move;
  assert.throws(() => new MorrisWasmEngine(missing), /missing required export/);
  assert.throws(
    () => new MorrisWasmEngine(makeFakeWasmExports({ morris_engine_search: () => 0 })),
    /arity 0; expected 12/,
  );
  assert.throws(
    () => new MorrisWasmEngine(
      makeFakeWasmExports({ morris_engine_create: wasmConstant(1, 0) }),
    ),
    /invalid engine handle 0/,
  );

  const illegal = new MorrisWasmEngine(
    makeFakeWasmExports({
      morris_engine_result_move: wasmConstant(2, 1 << 31),
    }),
  );
  assert.throws(() => illegal.search(createInitialPosition(SELF)), /Invalid Morris WASM move/);
});

test("worker search router permanently falls back after WASM initialization failure", async () => {
  let loads = 0;
  let fallbacks = 0;
  const fallback = (
    position: MorrisPosition,
    options = {},
  ) => {
    fallbacks += 1;
    return searchBestMoves(position, { ...options, timeMs: 100, maxDepth: 1, topN: 1 });
  };
  const router = new MorrisSearchRouter(async () => {
    loads += 1;
    throw new Error("WASM unavailable");
  }, fallback);

  const first = await router.search(createInitialPosition(SELF));
  const second = await router.search(createInitialPosition(SELF));
  assert.ok(first.bestMove && second.bestMove);
  assert.equal(loads, 1);
  assert.equal(fallbacks, 2);
});

test("worker search router abandons a failing WASM backend for its lifetime", async () => {
  let wasmSearches = 0;
  let destroys = 0;
  let fallbacks = 0;
  const router = new MorrisSearchRouter(
    () => ({
      search() {
        wasmSearches += 1;
        throw new Error("corrupt WASM result");
      },
      destroy() {
        destroys += 1;
      },
    }),
    (position, options) => {
      fallbacks += 1;
      return searchBestMoves(position, { ...options, timeMs: 100, maxDepth: 1, topN: 1 });
    },
  );

  await router.search(createInitialPosition(SELF));
  await router.search(createInitialPosition(SELF));
  assert.equal(wasmSearches, 1);
  assert.equal(destroys, 1);
  assert.equal(fallbacks, 2);
});

function encodeRawMove(
  kind: 0 | 1 | 2,
  from: number | null,
  to: number,
  capture: number | null,
): number {
  return (
    to |
    ((from ?? 31) << 5) |
    ((capture ?? 31) << 10) |
    (kind << 15)
  ) >>> 0;
}

const FAKE_ENGINE_HANDLE = 0x8000_0005;

function makeFakeWasmExports(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const first = encodeRawMove(0, null, algebraicToIndex("a7"), null);
  return {
    morris_engine_abi_version: () => 1,
    morris_engine_create: wasmConstant(1, FAKE_ENGINE_HANDLE | 0),
    morris_engine_destroy: wasmHandleConstant(1, undefined),
    morris_engine_clear_history: wasmHandleConstant(1, 0),
    morris_engine_push_history: wasmHandleConstant(6, 0),
    morris_engine_search: wasmHandleConstant(12, 0),
    morris_engine_result_count: wasmHandleConstant(1, 1),
    morris_engine_result_move: wasmHandleConstant(2, first),
    morris_engine_result_candidate_score: wasmHandleConstant(2, 42),
    morris_engine_result_candidate_pv_len: wasmHandleConstant(2, 1),
    morris_engine_result_candidate_pv_move: wasmHandleConstant(3, first),
    morris_engine_result_score: wasmHandleConstant(1, 42),
    morris_engine_result_depth: wasmHandleConstant(1, 3),
    morris_engine_result_nodes_low: wasmHandleConstant(1, 10),
    morris_engine_result_nodes_high: wasmHandleConstant(1, 0),
    morris_engine_result_nps_low: wasmHandleConstant(1, 20),
    morris_engine_result_nps_high: wasmHandleConstant(1, 0),
    morris_engine_result_completed: wasmHandleConstant(1, 1),
    morris_engine_result_timed_out: wasmHandleConstant(1, 0),
    morris_engine_result_leaves_low: wasmHandleConstant(1, 0),
    morris_engine_result_leaves_high: wasmHandleConstant(1, 0),
    morris_engine_result_symmetry_tt_hits_low: wasmHandleConstant(1, 0),
    morris_engine_result_symmetry_tt_hits_high: wasmHandleConstant(1, 0),
    morris_engine_result_tt_hits_low: wasmHandleConstant(1, 0),
    morris_engine_result_tt_hits_high: wasmHandleConstant(1, 0),
    morris_engine_result_placement_frontier_leaves_low: wasmHandleConstant(1, 0),
    morris_engine_result_placement_frontier_leaves_high: wasmHandleConstant(1, 0),
    morris_engine_result_placement_target_depth: wasmHandleConstant(1, 22),
    morris_engine_result_placement_complete: wasmHandleConstant(1, 1),
    ...overrides,
  };
}

function wasmHandleConstant(arity: number, value: unknown): (...arguments_: number[]) => unknown {
  const implementation = (handle: number, ...arguments_: number[]) => {
    void arguments_;
    assert.equal(handle, FAKE_ENGINE_HANDLE);
    return value;
  };
  Object.defineProperty(implementation, "length", { value: arity });
  return implementation;
}

function wasmConstant(arity: number, value: unknown): (...arguments_: number[]) => unknown {
  const implementation = (...arguments_: number[]) => {
    void arguments_;
    return value;
  };
  Object.defineProperty(implementation, "length", { value: arity });
  return implementation;
}
