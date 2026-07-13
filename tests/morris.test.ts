import assert from "node:assert/strict";
import test from "node:test";
import {
  EMPTY,
  OPPONENT,
  SELF,
  algebraicToIndex,
  applyMove,
  countMills,
  createInitialPosition,
  generateLegalMoves,
  getGameStatus,
  getPhase,
  getRemovablePieces,
  indexToAlgebraic,
  searchBestMoves,
  type MorrisCell,
  type MorrisPosition,
} from "../app/lib/morris";

function positionWith(
  entries: Array<[string, MorrisCell]>,
  turn = SELF,
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
