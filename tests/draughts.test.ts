import assert from "node:assert/strict";
import test from "node:test";
import {
  EMPTY,
  OPPONENT,
  SELF,
  SELF_KING,
  SELF_MAN,
  applyMove,
  countPieces,
  createInitialPosition,
  generateLegalMoves,
  indexToPoint,
  pdnToIndex,
  positionFromFen,
  positionToFen,
  searchBestMoves,
} from "../app/lib/draughts";

test("AC IV checkers starts on 8x8 with twelve pieces and either side can start", () => {
  const position = createInitialPosition();
  assert.equal(position.board.length, 32);
  assert.deepEqual(countPieces(position), {
    selfPieces: 12,
    opponentPieces: 12,
    selfKings: 0,
    opponentKings: 0,
  });
  assert.equal(position.turn, OPPONENT);
  assert.equal(generateLegalMoves(position).length, 7);
  assert.equal(createInitialPosition(SELF).turn, SELF);
  assert.equal(positionToFen(createInitialPosition(SELF)).startsWith("W:"), true);
  assert.deepEqual(indexToPoint(0), { row: 0, col: 1 });
  assert.deepEqual(indexToPoint(31), { row: 7, col: 6 });
});

test("position notation round-trips kings and side to move", () => {
  const fen = "W:WK22,24:BK8,10";
  const position = positionFromFen(fen);
  assert.equal(position.board[pdnToIndex(22)], SELF_KING);
  assert.equal(position.board[pdnToIndex(8)], -2);
  assert.equal(positionToFen(position), fen);
  assert.throws(() => positionFromFen("W:W1:B1"), /Duplicate/);
});

test("capture is mandatory", () => {
  const position = positionFromFen("W:W22,24:B18");
  const moves = generateLegalMoves(position);
  assert.ok(moves.length > 0);
  assert.ok(moves.every((move) => move.isCapture));
  assert.ok(moves.every((move) => move.from === pdnToIndex(22)));
});

test("men move and capture forward only under English rules", () => {
  const forward = positionFromFen("W:W22:B18");
  assert.ok(generateLegalMoves(forward).some((move) => move.isCapture));

  const backwardVictim = positionFromFen("W:W18:B22");
  assert.ok(generateLegalMoves(backwardVictim).every((move) => !move.isCapture));
});

test("multi-jump is one complete turn with every landing and capture retained", () => {
  const position = positionFromFen("W:W26:B22,14");
  const moves = generateLegalMoves(position);
  assert.equal(moves.length, 1);
  const move = moves[0];
  assert.equal(move.captureCount, 2);
  assert.equal(move.route.length, 3);
  assert.deepEqual(move.captured.map((index) => index + 1).sort((a, b) => a - b), [14, 22]);
  const next = applyMove(position, move);
  assert.equal(next.board[pdnToIndex(26)], EMPTY);
  assert.equal(next.board[pdnToIndex(22)], EMPTY);
  assert.equal(next.board[pdnToIndex(14)], EMPTY);
  assert.equal(next.board[move.to], SELF_MAN);
  assert.equal(next.turn, OPPONENT);
});

test("promotion ends a capture turn and crowns the man", () => {
  // 10x1 lands on the king row. A potential king capture is not continued
  // during the same turn under WCDF English draughts rules.
  const position = positionFromFen("W:W10:B6,7");
  const moves = generateLegalMoves(position);
  const crown = moves.find((move) => move.to === pdnToIndex(1));
  assert.ok(crown);
  assert.equal(crown.route.length, 2);
  assert.equal(crown.promotes, true);
  assert.equal(applyMove(position, crown).board[pdnToIndex(1)], SELF_KING);
});

test("kings move one diagonal square rather than flying", () => {
  const position = positionFromFen("W:WK14:B1");
  const moves = generateLegalMoves(position);
  assert.ok(moves.length > 0);
  assert.ok(moves.every((move) => {
    const from = indexToPoint(move.from);
    const to = indexToPoint(move.to);
    return Math.abs(from.row - to.row) === 1 && Math.abs(from.col - to.col) === 1;
  }));
});

test("local iterative search returns legal top-three choices", () => {
  const position = positionFromFen("B:W21,22,23:B9,10,11");
  const result = searchBestMoves(position, { timeMs: 120, maxDepth: 2, topN: 3 });
  assert.ok(result.bestMove);
  assert.equal(result.bestMove.player, OPPONENT);
  const legal = new Set(generateLegalMoves(position).map((move) => move.id));
  assert.ok(legal.has(result.bestMove.id));
  assert.ok(result.topMoves.length >= 1 && result.topMoves.length <= 3);
  assert.ok(result.topMoves.every((line) => legal.has(line.move.id)));
});
