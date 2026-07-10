import assert from "node:assert/strict";
import test from "node:test";
import {
  EMPTY,
  OPPONENT,
  SELF,
  algebraicToIndex,
  applyMove,
  createInitialPosition,
  generateLegalMoves,
  getSolvedOpeningMoves,
  indexToAlgebraic,
  searchBestMoves,
  type Cell,
  type Position,
} from "../app/lib/fanorona";

function positionWith(entries: Array<[string, Cell]>, turn = SELF): Position {
  const board = Array<Cell>(45).fill(EMPTY);
  for (const [point, piece] of entries) board[algebraicToIndex(point)] = piece;
  return { board, turn };
}

test("initial position uses the fixed AC assistant orientation", () => {
  const position = createInitialPosition(OPPONENT);
  assert.equal(position.board.filter((piece) => piece === OPPONENT).length, 22);
  assert.equal(position.board.filter((piece) => piece === SELF).length, 22);
  assert.equal(position.board[algebraicToIndex("e3")], EMPTY);
  assert.equal(indexToAlgebraic(0), "a5");
  assert.equal(indexToAlgebraic(44), "i1");
});

test("capture is mandatory when any capture exists", () => {
  const position = positionWith([
    ["a1", SELF],
    ["c1", OPPONENT],
    ["i5", OPPONENT],
  ]);
  const moves = generateLegalMoves(position);
  assert.ok(moves.length > 0);
  assert.ok(moves.every((move) => move.isCapture));
  assert.ok(
    moves.some(
      (move) =>
        move.steps[0].from === algebraicToIndex("a1") &&
        move.steps[0].to === algebraicToIndex("b1") &&
        move.steps[0].capture === "approach" &&
        move.steps[0].captured.includes(algebraicToIndex("c1")),
    ),
  );
});

test("approach and withdrawal remain distinct choices", () => {
  const position = positionWith([
    ["c3", SELF],
    ["a3", OPPONENT],
    ["b3", OPPONENT],
    ["e3", OPPONENT],
  ]);
  const openingSteps = generateLegalMoves(position)
    .map((move) => move.steps[0])
    .filter(
      (step) =>
        step.from === algebraicToIndex("c3") &&
        step.to === algebraicToIndex("d3"),
    );
  assert.ok(openingSteps.some((step) => step.capture === "approach"));
  assert.ok(openingSteps.some((step) => step.capture === "withdrawal"));
});

test("every capture prefix is a legal optional stopping point", () => {
  const position = positionWith([
    ["c3", SELF],
    ["e3", OPPONENT],
    ["d5", OPPONENT],
  ]);
  const moves = generateLegalMoves(position).filter(
    (move) =>
      move.steps[0].from === algebraicToIndex("c3") &&
      move.steps[0].to === algebraicToIndex("d3") &&
      move.steps[0].capture === "approach",
  );
  assert.ok(moves.some((move) => move.steps.length === 1));
  assert.ok(moves.some((move) => move.steps.length === 2));
});

test("applying a generated turn removes captures and changes sides", () => {
  const position = positionWith([
    ["a1", SELF],
    ["c1", OPPONENT],
  ]);
  const move = generateLegalMoves(position).find(
    (candidate) => candidate.notation === "a1-b1A",
  );
  assert.ok(move);
  const next = applyMove(position, move);
  assert.equal(next.board[algebraicToIndex("a1")], EMPTY);
  assert.equal(next.board[algebraicToIndex("b1")], SELF);
  assert.equal(next.board[algebraicToIndex("c1")], EMPTY);
  assert.equal(next.turn, OPPONENT);
});

test("initial search keeps the proven draw opening in its choices", () => {
  const position = createInitialPosition(SELF);
  const book = getSolvedOpeningMoves(position);
  assert.ok(book.some((move) => move.notation === "f2-e3A"));
  const result = searchBestMoves(position, { timeMs: 80, maxDepth: 2, topN: 2 });
  assert.ok(result.bestMove);
  assert.ok(result.topMoves.length > 0);
  assert.equal(result.topMoves[0].openingBook, true);
});

test("search returns a legal reply after an entered opponent turn", () => {
  const position = createInitialPosition(OPPONENT);
  const opponentMove = generateLegalMoves(position).find(
    (move) => move.notation === "d4-e3A",
  );
  assert.ok(opponentMove);
  const replyPosition = applyMove(position, opponentMove);
  const result = searchBestMoves(replyPosition, {
    timeMs: 100,
    maxDepth: 2,
    topN: 3,
  });
  assert.ok(result.bestMove);
  assert.equal(result.bestMove.player, SELF);
  assert.ok(
    generateLegalMoves(replyPosition).some((move) => move.id === result.bestMove?.id),
  );
});
