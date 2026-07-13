/**
 * English draughts / American checkers adapter and local MultiPV search.
 *
 * Assassin's Creed IV uses the 8x8, 12-piece English ruleset rather than
 * 10x10 international draughts. Legal moves and state transitions are based
 * on the MIT-licensed `rapid-draughts` WCDF engine:
 * https://github.com/loks0n/rapid-draughts
 *
 * The adapter keeps UI/worker state immutable and serializable. SELF is the
 * bottom (light) side moving upward; OPPONENT is the top (dark) side moving
 * downward. Display colors are intentionally not encoded in game state.
 */

import { DraughtsPlayer } from "rapid-draughts";
import {
  EnglishDraughts,
  EnglishDraughtsBitSquare,
  type EnglishDraughtsGame,
} from "rapid-draughts/english";

export const BOARD_ROWS = 8;
export const BOARD_COLS = 8;
export const PLAYABLE_SQUARES = 32;
export const BOARD_SIZE = PLAYABLE_SQUARES;

export const SELF = 1 as const;
export const OPPONENT = -1 as const;
export const EMPTY = 0 as const;
export const SELF_MAN = 1 as const;
export const SELF_KING = 2 as const;
export const OPPONENT_MAN = -1 as const;
export const OPPONENT_KING = -2 as const;

export type Player = typeof SELF | typeof OPPONENT;
export type Piece =
  | typeof EMPTY
  | typeof SELF_MAN
  | typeof SELF_KING
  | typeof OPPONENT_MAN
  | typeof OPPONENT_KING;
export type Cell = Piece;

export interface BoardPoint {
  row: number;
  col: number;
}

export interface DraughtsPosition {
  /** 32 playable dark squares, row-major from the top. */
  board: Piece[];
  turn: Player;
  ply?: number;
}

export type Position = DraughtsPosition;

export interface DraughtsMove {
  id: string;
  player: Player;
  /** Origin and each landing square, using zero-based playable indices. */
  route: number[];
  from: number;
  to: number;
  isCapture: boolean;
  captured: number[];
  captureCount: number;
  promotes: boolean;
  /** Standard 1..32 notation, such as `9-13` or `10x17x26`. */
  notation: string;
}

export type TurnMove = DraughtsMove;

export interface PieceCounts {
  selfPieces: number;
  opponentPieces: number;
  selfKings: number;
  opponentKings: number;
}

export interface DraughtsGameStatus extends PieceCounts {
  state: "playing" | "won";
  winner: Player | null;
  reason: "elimination" | "immobilization" | null;
}

export interface SearchOptions {
  timeMs?: number;
  maxDepth?: number;
  topN?: number;
  quiescenceDepth?: number;
  maxTableEntries?: number;
  shouldStop?: () => boolean;
}

export interface SearchLine {
  move: DraughtsMove;
  score: number;
  pv: DraughtsMove[];
  openingBook: false;
}

export interface SearchProgress {
  depth: number;
  nodes: number;
  timeMs: number;
  nps: number;
  score: number;
  pv: DraughtsMove[];
  topMoves: SearchLine[];
}

export interface SearchResult extends SearchProgress {
  bestMove: DraughtsMove | null;
  completed: boolean;
  timedOut: boolean;
}

export type SearchProgressCallback = (progress: SearchProgress) => void;

const INITIAL_BOARD: readonly Piece[] = [
  ...Array<Piece>(12).fill(OPPONENT_MAN),
  ...Array<Piece>(8).fill(EMPTY),
  ...Array<Piece>(12).fill(SELF_MAN),
];

// rapid-draughts uses a padded bitboard layout internally. This is the
// package's published 1D adapter order: UI square index -> bit index.
const RAPID_BIT_INDEX: readonly number[] = [
  11, 5, 31, 25, 10, 4, 30, 24,
  3, 29, 23, 17, 2, 28, 22, 16,
  27, 21, 15, 9, 26, 20, 14, 8,
  19, 13, 7, 1, 18, 12, 6, 0,
];

/** Dark/top traditionally starts; pass SELF when the assisted player starts. */
export function createInitialPosition(turn: Player = OPPONENT): DraughtsPosition {
  assertPlayer(turn);
  return { board: [...INITIAL_BOARD], turn, ply: 0 };
}

export function createPosition(
  entries: Iterable<readonly [number, Piece]>,
  turn: Player = SELF,
): DraughtsPosition {
  assertPlayer(turn);
  const board = Array<Piece>(PLAYABLE_SQUARES).fill(EMPTY);
  for (const [index, piece] of entries) {
    assertIndex(index);
    assertPiece(piece);
    board[index] = piece;
  }
  return { board, turn, ply: 0 };
}

export function otherPlayer(player: Player): Player {
  assertPlayer(player);
  return player === SELF ? OPPONENT : SELF;
}

export function indexToPdn(index: number): number {
  assertIndex(index);
  return index + 1;
}

export function pdnToIndex(square: number): number {
  if (!Number.isInteger(square) || square < 1 || square > PLAYABLE_SQUARES) {
    throw new RangeError(`Invalid English draughts square: ${square}`);
  }
  return square - 1;
}

export function indexToPoint(index: number): BoardPoint {
  assertIndex(index);
  const row = Math.floor(index / 4);
  const slot = index % 4;
  return { row, col: slot * 2 + (row % 2 === 0 ? 1 : 0) };
}

export function pointToIndex(point: BoardPoint): number {
  const { row, col } = point;
  if (
    !Number.isInteger(row) ||
    !Number.isInteger(col) ||
    row < 0 ||
    row >= BOARD_ROWS ||
    col < 0 ||
    col >= BOARD_COLS ||
    (row + col) % 2 !== 1
  ) {
    throw new RangeError(`Invalid playable draughts point (${row}, ${col})`);
  }
  return row * 4 + Math.floor(col / 2);
}

export function countPieces(positionOrBoard: DraughtsPosition | readonly Piece[]): PieceCounts {
  const board = Array.isArray(positionOrBoard)
    ? positionOrBoard
    : (positionOrBoard as DraughtsPosition).board;
  assertBoard(board);
  let selfPieces = 0;
  let opponentPieces = 0;
  let selfKings = 0;
  let opponentKings = 0;
  for (const piece of board) {
    if (piece > 0) selfPieces += 1;
    if (piece < 0) opponentPieces += 1;
    if (piece === SELF_KING) selfKings += 1;
    if (piece === OPPONENT_KING) opponentKings += 1;
  }
  return { selfPieces, opponentPieces, selfKings, opponentKings };
}

/** Portable checker-position notation using W=self/light and B=opponent/dark. */
export function positionToFen(position: DraughtsPosition): string {
  assertPosition(position);
  const white: string[] = [];
  const black: string[] = [];
  for (let index = 0; index < PLAYABLE_SQUARES; index += 1) {
    const square = index + 1;
    const piece = position.board[index];
    if (piece === SELF_MAN) white.push(String(square));
    if (piece === SELF_KING) white.push(`K${square}`);
    if (piece === OPPONENT_MAN) black.push(String(square));
    if (piece === OPPONENT_KING) black.push(`K${square}`);
  }
  return `${position.turn === SELF ? "W" : "B"}:W${white.join(",")}:B${black.join(",")}`;
}

export function positionFromFen(fen: string): DraughtsPosition {
  if (typeof fen !== "string") throw new TypeError("Draughts FEN must be a string");
  const match = /^\s*([WB])\s*:\s*([WB])([^:]*)\s*:\s*([WB])([^:]*)\s*$/i.exec(fen);
  if (!match || match[2].toUpperCase() === match[4].toUpperCase()) {
    throw new Error(`Invalid English draughts FEN: ${fen}`);
  }
  const board = Array<Piece>(PLAYABLE_SQUARES).fill(EMPTY);
  const seen = new Set<number>();
  const addSide = (color: string, body: string) => {
    const player = color.toUpperCase() === "W" ? SELF : OPPONENT;
    const tokens = body.trim() ? body.split(",") : [];
    for (const rawToken of tokens) {
      const token = rawToken.trim();
      const king = /^K/i.test(token);
      const numeric = king ? token.slice(1) : token;
      const range = /^(\d+)(?:-(\d+))?$/.exec(numeric);
      if (!range) throw new Error(`Invalid draughts FEN piece: ${rawToken}`);
      const first = Number(range[1]);
      const last = range[2] ? Number(range[2]) : first;
      if (first < 1 || last > PLAYABLE_SQUARES || first > last) {
        throw new Error(`Draughts FEN square is out of range: ${rawToken}`);
      }
      for (let square = first; square <= last; square += 1) {
        if (seen.has(square)) throw new Error(`Duplicate draughts FEN square: ${square}`);
        seen.add(square);
        board[square - 1] = player === SELF
          ? king ? SELF_KING : SELF_MAN
          : king ? OPPONENT_KING : OPPONENT_MAN;
      }
    }
  };
  addSide(match[2], match[3]);
  addSide(match[4], match[5]);
  return { board, turn: match[1].toUpperCase() === "W" ? SELF : OPPONENT, ply: 0 };
}

export function formatMove(move: Pick<DraughtsMove, "route" | "isCapture">): string {
  return move.route.map(indexToPdn).join(move.isCapture ? "x" : "-");
}

export function moveId(move: Pick<DraughtsMove, "route" | "captured">): string {
  return `${move.route.join(".")}|${[...move.captured].sort((a, b) => a - b).join(".")}`;
}

/** Returns complete legal turns generated by rapid-draughts' WCDF engine. */
export function generateLegalMoves(position: DraughtsPosition): DraughtsMove[] {
  assertPosition(position);
  const game = createRapidGame(position);
  return game.moves.map((raw) => {
    const from = raw.origin;
    const to = raw.destination;
    const captured = [...raw.captures];
    const route = captured.length === 0
      ? [from, to]
      : reconstructCaptureRoute(position, from, to, captured);
    const piece = position.board[from];
    const promotes =
      (piece === SELF_MAN && indexToPoint(to).row === 0) ||
      (piece === OPPONENT_MAN && indexToPoint(to).row === 7);
    const shell = { route, captured };
    const move: DraughtsMove = {
      id: moveId(shell),
      player: position.turn,
      route,
      from,
      to,
      isCapture: captured.length > 0,
      captured,
      captureCount: captured.length,
      promotes,
      notation: "",
    };
    move.notation = formatMove(move);
    return move;
  });
}

export function findMovesByRoute(
  position: DraughtsPosition,
  route: readonly number[],
): DraughtsMove[] {
  if (route.length < 2) return [];
  return generateLegalMoves(position).filter(
    (move) => move.route.length === route.length && move.route.every((square, i) => square === route[i]),
  );
}

export function applyMove(position: DraughtsPosition, move: DraughtsMove): DraughtsPosition {
  const legal = generateLegalMoves(position).find((candidate) => candidate.id === move.id);
  if (!legal) throw new Error(`Illegal English draughts turn: ${move.notation}`);
  return applyMoveUnchecked(position, legal);
}

export function applyMoveUnchecked(
  position: DraughtsPosition,
  move: DraughtsMove,
): DraughtsPosition {
  const board = [...position.board];
  let piece = board[move.from];
  if (piece === EMPTY || Math.sign(piece) !== position.turn) {
    throw new Error("Draughts move origin does not contain the side to move");
  }
  board[move.from] = EMPTY;
  for (const captured of move.captured) board[captured] = EMPTY;
  if (piece === SELF_MAN && indexToPoint(move.to).row === 0) piece = SELF_KING;
  if (piece === OPPONENT_MAN && indexToPoint(move.to).row === 7) piece = OPPONENT_KING;
  board[move.to] = piece;
  return { board, turn: otherPlayer(position.turn), ply: (position.ply ?? 0) + 1 };
}

export function getGameStatus(position: DraughtsPosition): DraughtsGameStatus {
  const counts = countPieces(position);
  if (counts.selfPieces === 0 || counts.opponentPieces === 0) {
    return {
      ...counts,
      state: "won",
      winner: counts.selfPieces === 0 ? OPPONENT : SELF,
      reason: "elimination",
    };
  }
  if (generateLegalMoves(position).length === 0) {
    return {
      ...counts,
      state: "won",
      winner: otherPlayer(position.turn),
      reason: "immobilization",
    };
  }
  return { ...counts, state: "playing", winner: null, reason: null };
}

function createRapidGame(position: DraughtsPosition): EnglishDraughtsGame {
  let light = 0;
  let dark = 0;
  let king = 0;
  for (let index = 0; index < PLAYABLE_SQUARES; index += 1) {
    const piece = position.board[index];
    if (piece === EMPTY) continue;
    const mask = EnglishDraughtsBitSquare[RAPID_BIT_INDEX[index]];
    if (piece > 0) light |= mask;
    if (piece < 0) dark |= mask;
    if (Math.abs(piece) === 2) king |= mask;
  }
  return EnglishDraughts.setup({
    player: position.turn === SELF ? DraughtsPlayer.LIGHT : DraughtsPlayer.DARK,
    board: { light, dark, king },
    stats: { sinceCapture: 0, sinceNonKingAdvance: 0 },
  });
}

/** Rebuilds the visible landing path omitted by the engine's compact bit move. */
function reconstructCaptureRoute(
  position: DraughtsPosition,
  origin: number,
  destination: number,
  captures: readonly number[],
): number[] {
  const targets = new Set(captures);
  const piece = position.board[origin];
  const board = [...position.board];
  const route = [origin];

  const visit = (from: number, remaining: Set<number>): boolean => {
    if (remaining.size === 0) return from === destination;
    const fromPoint = indexToPoint(from);
    const directions = Math.abs(piece) === 2
      ? [[-1, -1], [-1, 1], [1, -1], [1, 1]]
      : piece > 0 ? [[-1, -1], [-1, 1]] : [[1, -1], [1, 1]];
    for (const [dr, dc] of directions) {
      const middlePoint = { row: fromPoint.row + dr, col: fromPoint.col + dc };
      const landingPoint = { row: fromPoint.row + dr * 2, col: fromPoint.col + dc * 2 };
      if (!isPlayablePoint(middlePoint) || !isPlayablePoint(landingPoint)) continue;
      const middle = pointToIndex(middlePoint);
      const landing = pointToIndex(landingPoint);
      if (!remaining.has(middle) || board[landing] !== EMPTY) continue;
      const capturedPiece = board[middle];
      if (capturedPiece === EMPTY || Math.sign(capturedPiece) === Math.sign(piece)) continue;

      board[from] = EMPTY;
      board[middle] = EMPTY;
      board[landing] = piece;
      route.push(landing);
      const next = new Set(remaining);
      next.delete(middle);
      const reachedCrown =
        (piece === SELF_MAN && landingPoint.row === 0) ||
        (piece === OPPONENT_MAN && landingPoint.row === 7);
      const found = (reachedCrown ? next.size === 0 && landing === destination : visit(landing, next));
      if (found) return true;
      route.pop();
      board[landing] = EMPTY;
      board[middle] = capturedPiece;
      board[from] = piece;
    }
    return false;
  };

  if (!visit(origin, targets)) {
    throw new Error("Could not reconstruct the capture route returned by rapid-draughts");
  }
  return route;
}

function isPlayablePoint(point: BoardPoint): boolean {
  return point.row >= 0 && point.row < 8 && point.col >= 0 && point.col < 8 &&
    (point.row + point.col) % 2 === 1;
}

// ---------------------------------------------------------------------------
// Iterative-deepening alpha-beta. rapid-draughts includes a single-PV async
// alpha-beta player; this synchronous wrapper uses its fast WCDF engine for
// legal nodes while adding progress, cancellation and top-three root lines.
// ---------------------------------------------------------------------------

const WIN_SCORE = 1_000_000;
const INF = WIN_SCORE + 100_000;
type TTFlag = "exact" | "lower" | "upper";
interface TTEntry { depth: number; score: number; flag: TTFlag; bestMoveId: string | null }
interface SearchContext {
  startedAt: number;
  deadline: number;
  nodes: number;
  qDepth: number;
  maxTableEntries: number;
  shouldStop?: () => boolean;
  table: Map<string, TTEntry>;
  history: Map<string, number>;
  path: Set<string>;
}
interface RootScore { move: DraughtsMove; score: number; pv: DraughtsMove[] }
class SearchStopped extends Error {}

export function searchBestMoves(
  position: DraughtsPosition,
  options: SearchOptions = {},
  onProgress?: SearchProgressCallback,
): SearchResult {
  assertPosition(position);
  const startedAt = nowMs();
  const maxDepth = clampInteger(options.maxDepth ?? 12, 1, 40);
  const topN = clampInteger(options.topN ?? 3, 1, 12);
  const context: SearchContext = {
    startedAt,
    deadline: startedAt + clampInteger(options.timeMs ?? 1600, 20, 120_000),
    nodes: 0,
    qDepth: clampInteger(options.quiescenceDepth ?? 4, 0, 16),
    maxTableEntries: clampInteger(options.maxTableEntries ?? 180_000, 500, 1_000_000),
    shouldStop: options.shouldStop,
    table: new Map(),
    history: new Map(),
    path: new Set(),
  };
  let rootMoves = orderMoves(generateLegalMoves(position), null, context);
  if (rootMoves.length === 0) return emptySearchResult(startedAt);
  let completedDepth = 0;
  let completedScores = fallbackRootScores(position, rootMoves);
  let timedOut = false;

  for (let depth = 1; depth <= maxDepth; depth += 1) {
    const iteration: RootScore[] = [];
    try {
      checkStop(context, true);
      rootMoves = [...rootMoves].sort((a, b) => {
        const aScore = completedScores.find((line) => line.move.id === a.id)?.score ?? -INF;
        const bScore = completedScores.find((line) => line.move.id === b.id)?.score ?? -INF;
        return bScore - aScore;
      });
      context.path.clear();
      context.path.add(positionKey(position));
      for (const move of rootMoves) {
        checkStop(context, true);
        const child = applyMoveUnchecked(position, move);
        const score = -negamax(child, depth - 1, -INF, INF, 1, context);
        iteration.push({ move, score, pv: [move, ...extractPv(child, depth - 1, context)] });
      }
      completedDepth = depth;
      completedScores = sortRootScores(iteration);
      rootMoves = completedScores.map((line) => line.move);
      onProgress?.(makeProgress(completedDepth, completedScores, topN, context));
    } catch (error) {
      if (!(error instanceof SearchStopped)) throw error;
      timedOut = true;
      break;
    }
  }

  const topMoves = completedScores.slice(0, topN).map(toSearchLine);
  const timeMs = Math.max(0, nowMs() - startedAt);
  const best = topMoves[0] ?? null;
  return {
    bestMove: best?.move ?? null,
    topMoves,
    depth: completedDepth,
    nodes: context.nodes,
    timeMs,
    nps: timeMs > 0 ? Math.round(context.nodes * 1000 / timeMs) : 0,
    score: best?.score ?? -WIN_SCORE,
    pv: best?.pv ?? [],
    completed: !timedOut && completedDepth >= maxDepth,
    timedOut,
  };
}

function negamax(
  position: DraughtsPosition,
  depth: number,
  alphaInput: number,
  beta: number,
  ply: number,
  context: SearchContext,
): number {
  context.nodes += 1;
  checkStop(context);
  const key = positionKey(position);
  if (context.path.has(key)) return 0;
  const counts = countPieces(position);
  if (counts.selfPieces === 0 || counts.opponentPieces === 0) {
    const winner = counts.selfPieces === 0 ? OPPONENT : SELF;
    return winner === position.turn ? WIN_SCORE - ply : -WIN_SCORE + ply;
  }
  if (depth <= 0) return quiescence(position, alphaInput, beta, ply, context.qDepth, context);

  const alphaOriginal = alphaInput;
  let alpha = alphaInput;
  const cached = context.table.get(key);
  if (cached && cached.depth >= depth) {
    if (cached.flag === "exact") return cached.score;
    if (cached.flag === "lower") alpha = Math.max(alpha, cached.score);
    if (cached.flag === "upper" && cached.score <= alpha) return cached.score;
    if (alpha >= beta) return cached.score;
  }
  let moves = generateLegalMoves(position);
  if (moves.length === 0) return -WIN_SCORE + ply;
  moves = orderMoves(moves, cached?.bestMoveId ?? null, context);
  let best = -INF;
  let bestMoveId: string | null = null;
  context.path.add(key);
  try {
    for (const move of moves) {
      const score = -negamax(applyMoveUnchecked(position, move), depth - 1, -beta, -alpha, ply + 1, context);
      if (score > best) { best = score; bestMoveId = move.id; }
      if (score > alpha) alpha = score;
      if (alpha >= beta) {
        context.history.set(move.id, (context.history.get(move.id) ?? 0) + depth * depth);
        break;
      }
    }
  } finally {
    context.path.delete(key);
  }
  const flag: TTFlag = best <= alphaOriginal ? "upper" : best >= beta ? "lower" : "exact";
  storeTable(context, key, { depth, score: best, flag, bestMoveId });
  return best;
}

function quiescence(
  position: DraughtsPosition,
  alphaInput: number,
  beta: number,
  ply: number,
  remaining: number,
  context: SearchContext,
): number {
  context.nodes += 1;
  checkStop(context);
  const key = positionKey(position);
  if (context.path.has(key)) return 0;
  const counts = countPieces(position);
  if (counts.selfPieces === 0 || counts.opponentPieces === 0) {
    const winner = counts.selfPieces === 0 ? OPPONENT : SELF;
    return winner === position.turn ? WIN_SCORE - ply : -WIN_SCORE + ply;
  }
  const moves = generateLegalMoves(position);
  if (moves.length === 0) return -WIN_SCORE + ply;
  if (!moves[0].isCapture || remaining <= 0) return evaluatePosition(position, position.turn);
  let alpha = alphaInput;
  let best = -INF;
  context.path.add(key);
  try {
    for (const move of orderMoves(moves, null, context)) {
      const score = -quiescence(
        applyMoveUnchecked(position, move), -beta, -alpha, ply + 1, remaining - 1, context,
      );
      if (score > best) best = score;
      if (score > alpha) alpha = score;
      if (alpha >= beta) break;
    }
  } finally {
    context.path.delete(key);
  }
  return best;
}

export function evaluatePosition(position: DraughtsPosition, perspective: Player): number {
  assertPosition(position);
  assertPlayer(perspective);
  let score = 0;
  for (let index = 0; index < PLAYABLE_SQUARES; index += 1) {
    const piece = position.board[index];
    if (piece === EMPTY) continue;
    const { row, col } = indexToPoint(index);
    const center = 7 - (Math.abs(row - 3.5) + Math.abs(col - 3.5));
    if (piece === SELF_MAN) score += 100 + (7 - row) * 6 + (row === 7 ? 7 : 0);
    if (piece === OPPONENT_MAN) score -= 100 + row * 6 + (row === 0 ? 7 : 0);
    if (piece === SELF_KING) score += 175 + center * 3;
    if (piece === OPPONENT_KING) score -= 175 + center * 3;
  }
  score += (approximateMobility(position.board, SELF) - approximateMobility(position.board, OPPONENT)) * 2;
  return perspective === SELF ? Math.round(score) : -Math.round(score);
}

function approximateMobility(board: readonly Piece[], player: Player): number {
  let mobility = 0;
  for (let index = 0; index < PLAYABLE_SQUARES; index += 1) {
    const piece = board[index];
    if (piece === EMPTY || Math.sign(piece) !== player) continue;
    const point = indexToPoint(index);
    const directions = Math.abs(piece) === 2
      ? [[-1, -1], [-1, 1], [1, -1], [1, 1]]
      : player === SELF ? [[-1, -1], [-1, 1]] : [[1, -1], [1, 1]];
    for (const [dr, dc] of directions) {
      const target = { row: point.row + dr, col: point.col + dc };
      if (isPlayablePoint(target) && board[pointToIndex(target)] === EMPTY) mobility += 1;
    }
  }
  return mobility;
}

function orderMoves(moves: readonly DraughtsMove[], preferred: string | null, context: SearchContext): DraughtsMove[] {
  const rank = (move: DraughtsMove) => (move.id === preferred ? 1_000_000 : 0) +
    move.captureCount * 20_000 + (move.promotes ? 5_000 : 0) + (context.history.get(move.id) ?? 0);
  return [...moves].sort((a, b) => rank(b) - rank(a));
}

function fallbackRootScores(position: DraughtsPosition, moves: readonly DraughtsMove[]): RootScore[] {
  return sortRootScores(moves.map((move) => {
    const child = applyMoveUnchecked(position, move);
    return { move, score: -evaluatePosition(child, child.turn), pv: [move] };
  }));
}

function sortRootScores(lines: readonly RootScore[]): RootScore[] {
  return [...lines].sort((a, b) => b.score - a.score || a.move.id.localeCompare(b.move.id));
}

function toSearchLine(line: RootScore): SearchLine {
  return { ...line, openingBook: false };
}

function makeProgress(depth: number, lines: readonly RootScore[], topN: number, context: SearchContext): SearchProgress {
  const topMoves = lines.slice(0, topN).map(toSearchLine);
  const timeMs = Math.max(0, nowMs() - context.startedAt);
  return {
    depth,
    nodes: context.nodes,
    timeMs,
    nps: timeMs > 0 ? Math.round(context.nodes * 1000 / timeMs) : 0,
    score: topMoves[0]?.score ?? -WIN_SCORE,
    pv: topMoves[0]?.pv ?? [],
    topMoves,
  };
}

function extractPv(position: DraughtsPosition, depth: number, context: SearchContext): DraughtsMove[] {
  const pv: DraughtsMove[] = [];
  const seen = new Set<string>();
  let current = position;
  for (let remaining = depth; remaining > 0; remaining -= 1) {
    const key = positionKey(current);
    if (seen.has(key)) break;
    seen.add(key);
    const bestId = context.table.get(key)?.bestMoveId;
    if (!bestId) break;
    const move = generateLegalMoves(current).find((candidate) => candidate.id === bestId);
    if (!move) break;
    pv.push(move);
    current = applyMoveUnchecked(current, move);
  }
  return pv;
}

function positionKey(position: DraughtsPosition): string {
  return `${position.turn}|${position.board.join(",")}`;
}

function storeTable(context: SearchContext, key: string, entry: TTEntry): void {
  if (context.table.size >= context.maxTableEntries && !context.table.has(key)) {
    const oldest = context.table.keys().next().value as string | undefined;
    if (oldest !== undefined) context.table.delete(oldest);
  }
  context.table.set(key, entry);
}

function emptySearchResult(startedAt: number): SearchResult {
  return {
    bestMove: null, topMoves: [], depth: 0, nodes: 0,
    timeMs: Math.max(0, nowMs() - startedAt), nps: 0, score: -WIN_SCORE,
    pv: [], completed: true, timedOut: false,
  };
}

function checkStop(context: SearchContext, force = false): void {
  if (!force && (context.nodes & 63) !== 0) return;
  if (nowMs() >= context.deadline || context.shouldStop?.()) throw new SearchStopped();
}

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function assertIndex(index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= PLAYABLE_SQUARES) {
    throw new RangeError(`Invalid draughts board index: ${index}`);
  }
}

function assertPlayer(player: number): asserts player is Player {
  if (player !== SELF && player !== OPPONENT) throw new RangeError(`Invalid draughts player: ${player}`);
}

function assertPiece(piece: number): asserts piece is Piece {
  if (![EMPTY, SELF_MAN, SELF_KING, OPPONENT_MAN, OPPONENT_KING].includes(piece as Piece)) {
    throw new RangeError(`Invalid draughts piece: ${piece}`);
  }
}

function assertBoard(board: readonly number[]): asserts board is readonly Piece[] {
  if (board.length !== PLAYABLE_SQUARES) throw new RangeError("An English draughts board must have 32 cells");
  for (const piece of board) assertPiece(piece);
}

function assertPosition(position: DraughtsPosition): void {
  assertBoard(position.board);
  assertPlayer(position.turn);
}
