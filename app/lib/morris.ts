/**
 * Nine Men's Morris rules and search engine.
 *
 * The immutable state/action split and board-service organization were
 * informed by the MIT-licensed grudus/NineMensMorris and cyrilf/windmill
 * projects. This implementation is original and closes their relevant rule
 * gaps: removal restrictions, flying, complete turns, and terminal mobility.
 */

export const MORRIS_BOARD_SIZE = 24;
export const PIECES_PER_PLAYER = 9;

export const SELF = 1 as const;
export const OPPONENT = -1 as const;
export const EMPTY = 0 as const;

export type Player = typeof SELF | typeof OPPONENT;
export type MorrisCell = Player | typeof EMPTY;
export type MorrisPhase = "placing" | "moving" | "flying";
export type MoveKind = "place" | "move" | "fly";

export interface MorrisPoint {
  readonly index: number;
  readonly label: string;
  /** Logical 7 x 7 board coordinate, useful for SVG/Canvas rendering. */
  readonly row: number;
  readonly col: number;
}

export interface MorrisPosition {
  readonly board: readonly MorrisCell[];
  readonly turn: Player;
  readonly selfToPlace: number;
  readonly opponentToPlace: number;
  readonly ply?: number;
}

export interface MorrisMove {
  /** Stable structural id, suitable for React keys and worker round-trips. */
  readonly id: string;
  readonly player: Player;
  readonly kind: MoveKind;
  /** Null for a placement. */
  readonly from: number | null;
  readonly to: number;
  /** A mill closes exactly one opposing piece removal when one is available. */
  readonly remove: number | null;
  readonly formsMill: boolean;
  readonly notation: string;
}

export type Position = MorrisPosition;
export type Move = MorrisMove;

export type GameEndReason = "fewer-than-three" | "immobilization";

export interface GameStatus {
  readonly state: "playing" | "won";
  readonly winner: Player | null;
  readonly reason: GameEndReason | null;
  readonly selfPieces: number;
  readonly opponentPieces: number;
  readonly selfToPlace: number;
  readonly opponentToPlace: number;
}

export interface SearchOptions {
  /** Hard thinking budget in milliseconds. Defaults to 1500. */
  readonly timeMs?: number;
  /** Maximum completed full-turn depth. Defaults to 8. */
  readonly maxDepth?: number;
  /** Number of independently scored root choices. Defaults to 3. */
  readonly topN?: number;
  /** Maximum transposition-table entries retained by this search. */
  readonly maxTableEntries?: number;
  /** Cooperative stop hook for workers and direct callers. */
  readonly shouldStop?: () => boolean;
}

export interface SearchLine {
  readonly move: MorrisMove;
  /** Centipawn-like score from the root side's perspective. */
  readonly score: number;
  readonly pv: readonly MorrisMove[];
}

export interface SearchProgress {
  readonly depth: number;
  readonly nodes: number;
  readonly timeMs: number;
  readonly nps: number;
  readonly score: number;
  readonly pv: readonly MorrisMove[];
  readonly topMoves: readonly SearchLine[];
}

export interface SearchResult extends SearchProgress {
  readonly bestMove: MorrisMove | null;
  readonly completed: boolean;
  readonly timedOut: boolean;
}

export type SearchProgressCallback = (progress: SearchProgress) => void;

export const MORRIS_POINTS: readonly MorrisPoint[] = [
  { index: 0, label: "a7", row: 0, col: 0 },
  { index: 1, label: "d7", row: 0, col: 3 },
  { index: 2, label: "g7", row: 0, col: 6 },
  { index: 3, label: "b6", row: 1, col: 1 },
  { index: 4, label: "d6", row: 1, col: 3 },
  { index: 5, label: "f6", row: 1, col: 5 },
  { index: 6, label: "c5", row: 2, col: 2 },
  { index: 7, label: "d5", row: 2, col: 3 },
  { index: 8, label: "e5", row: 2, col: 4 },
  { index: 9, label: "a4", row: 3, col: 0 },
  { index: 10, label: "b4", row: 3, col: 1 },
  { index: 11, label: "c4", row: 3, col: 2 },
  { index: 12, label: "e4", row: 3, col: 4 },
  { index: 13, label: "f4", row: 3, col: 5 },
  { index: 14, label: "g4", row: 3, col: 6 },
  { index: 15, label: "c3", row: 4, col: 2 },
  { index: 16, label: "d3", row: 4, col: 3 },
  { index: 17, label: "e3", row: 4, col: 4 },
  { index: 18, label: "b2", row: 5, col: 1 },
  { index: 19, label: "d2", row: 5, col: 3 },
  { index: 20, label: "f2", row: 5, col: 5 },
  { index: 21, label: "a1", row: 6, col: 0 },
  { index: 22, label: "d1", row: 6, col: 3 },
  { index: 23, label: "g1", row: 6, col: 6 },
] as const;

/** Every standard board line; a move may only follow one of these edges. */
export const ADJACENCY: readonly (readonly number[])[] = [
  [1, 9],
  [0, 2, 4],
  [1, 14],
  [4, 10],
  [1, 3, 5, 7],
  [4, 13],
  [7, 11],
  [4, 6, 8],
  [7, 12],
  [0, 10, 21],
  [3, 9, 11, 18],
  [6, 10, 15],
  [8, 13, 17],
  [5, 12, 14, 20],
  [2, 13, 23],
  [11, 16],
  [15, 17, 19],
  [12, 16],
  [10, 19],
  [16, 18, 20, 22],
  [13, 19],
  [9, 22],
  [19, 21, 23],
  [14, 22],
] as const;

/** The sixteen possible mills on the standard board. */
export const MILLS: readonly (readonly [number, number, number])[] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [9, 10, 11],
  [12, 13, 14],
  [15, 16, 17],
  [18, 19, 20],
  [21, 22, 23],
  [0, 9, 21],
  [3, 10, 18],
  [6, 11, 15],
  [1, 4, 7],
  [16, 19, 22],
  [8, 12, 17],
  [5, 13, 20],
  [2, 14, 23],
] as const;

const MILLS_BY_POINT: readonly (readonly number[])[] = Array.from(
  { length: MORRIS_BOARD_SIZE },
  (_, point) =>
    MILLS.flatMap((mill, index) => (mill.includes(point) ? [index] : [])),
);

const LABEL_TO_INDEX = new Map(
  MORRIS_POINTS.map((point) => [point.label, point.index]),
);

export function otherPlayer(player: Player): Player {
  return player === SELF ? OPPONENT : SELF;
}

export function createInitialPosition(
  turn: Player = OPPONENT,
): MorrisPosition {
  return {
    board: Array<MorrisCell>(MORRIS_BOARD_SIZE).fill(EMPTY),
    turn,
    selfToPlace: PIECES_PER_PLAYER,
    opponentToPlace: PIECES_PER_PLAYER,
    ply: 0,
  };
}

export function indexToAlgebraic(index: number): string {
  assertIndex(index);
  return MORRIS_POINTS[index].label;
}

export function algebraicToIndex(value: string): number {
  const index = LABEL_TO_INDEX.get(value.trim().toLowerCase());
  if (index === undefined) {
    throw new RangeError(`Invalid Nine Men's Morris coordinate: ${value}`);
  }
  return index;
}

export function getPiecesToPlace(
  position: MorrisPosition,
  player: Player,
): number {
  return player === SELF ? position.selfToPlace : position.opponentToPlace;
}

export function countPieces(
  positionOrBoard: MorrisPosition | readonly MorrisCell[],
  player: Player,
): number {
  const board = boardFrom(positionOrBoard);
  let count = 0;
  for (const cell of board) if (cell === player) count += 1;
  return count;
}

export function getPhase(
  position: MorrisPosition,
  player: Player = position.turn,
): MorrisPhase {
  if (getPiecesToPlace(position, player) > 0) return "placing";
  return countPieces(position, player) === 3 ? "flying" : "moving";
}

export function isMillAt(
  boardOrPosition: readonly MorrisCell[] | MorrisPosition,
  point: number,
  player?: Player,
): boolean {
  assertIndex(point);
  const board = boardFrom(boardOrPosition);
  const owner = player ?? board[point];
  if (owner === EMPTY) return false;
  return MILLS_BY_POINT[point].some((millIndex) =>
    MILLS[millIndex].every((index) => board[index] === owner),
  );
}

export function countMills(
  boardOrPosition: readonly MorrisCell[] | MorrisPosition,
  player: Player,
): number {
  const board = boardFrom(boardOrPosition);
  let count = 0;
  for (const mill of MILLS) {
    if (mill.every((index) => board[index] === player)) count += 1;
  }
  return count;
}

/**
 * Returns legal removal targets after `player` closes a mill. Pieces outside
 * mills must be taken first; mill pieces become eligible only when every
 * opposing piece is protected by a mill.
 */
export function getRemovablePieces(
  boardOrPosition: readonly MorrisCell[] | MorrisPosition,
  player: Player,
): number[] {
  const board = boardFrom(boardOrPosition);
  const opponent = otherPlayer(player);
  const opposing: number[] = [];
  const exposed: number[] = [];
  for (let index = 0; index < MORRIS_BOARD_SIZE; index += 1) {
    if (board[index] !== opponent) continue;
    opposing.push(index);
    if (!isMillAt(board, index, opponent)) exposed.push(index);
  }
  return exposed.length > 0 ? exposed : opposing;
}

export function formatMove(
  move: Pick<MorrisMove, "from" | "to" | "remove">,
): string {
  const movement =
    move.from === null
      ? `@${indexToAlgebraic(move.to)}`
      : `${indexToAlgebraic(move.from)}-${indexToAlgebraic(move.to)}`;
  return move.remove === null
    ? movement
    : `${movement}x${indexToAlgebraic(move.remove)}`;
}

function createMove(
  player: Player,
  kind: MoveKind,
  from: number | null,
  to: number,
  remove: number | null,
  formsMill: boolean,
): MorrisMove {
  const structural = `${player}:${kind}:${from ?? "@"}-${to}x${remove ?? "-"}`;
  const move = { id: structural, player, kind, from, to, remove, formsMill };
  return { ...move, notation: formatMove(move) };
}

interface BaseAction {
  readonly kind: MoveKind;
  readonly from: number | null;
  readonly to: number;
}

function generateBaseActions(position: MorrisPosition): BaseAction[] {
  const { board, turn } = position;
  const phase = getPhase(position, turn);
  const actions: BaseAction[] = [];

  if (phase === "placing") {
    for (let to = 0; to < MORRIS_BOARD_SIZE; to += 1) {
      if (board[to] === EMPTY) actions.push({ kind: "place", from: null, to });
    }
    return actions;
  }

  if (countPieces(position, turn) < 3) return actions;
  const canFly = phase === "flying";
  for (let from = 0; from < MORRIS_BOARD_SIZE; from += 1) {
    if (board[from] !== turn) continue;
    if (canFly) {
      for (let to = 0; to < MORRIS_BOARD_SIZE; to += 1) {
        if (board[to] === EMPTY) actions.push({ kind: "fly", from, to });
      }
    } else {
      for (const to of ADJACENCY[from]) {
        if (board[to] === EMPTY) actions.push({ kind: "move", from, to });
      }
    }
  }
  return actions;
}

/** Generates complete turns, including the required removal after a mill. */
export function generateLegalMoves(position: MorrisPosition): MorrisMove[] {
  assertPosition(position);
  const moves: MorrisMove[] = [];
  for (const action of generateBaseActions(position)) {
    const board = applyBaseAction(position.board, position.turn, action);
    const formsMill = isMillAt(board, action.to, position.turn);
    if (!formsMill) {
      moves.push(
        createMove(
          position.turn,
          action.kind,
          action.from,
          action.to,
          null,
          false,
        ),
      );
      continue;
    }

    const removable = getRemovablePieces(board, position.turn);
    if (removable.length === 0) {
      moves.push(
        createMove(
          position.turn,
          action.kind,
          action.from,
          action.to,
          null,
          true,
        ),
      );
      continue;
    }
    for (const remove of removable) {
      moves.push(
        createMove(
          position.turn,
          action.kind,
          action.from,
          action.to,
          remove,
          true,
        ),
      );
    }
  }
  return moves;
}

/** Applies a legal complete turn without mutating either argument. */
export function applyMove(
  position: MorrisPosition,
  candidate: MorrisMove,
): MorrisPosition {
  assertPosition(position);
  const move = generateLegalMoves(position).find(
    (legal) => legal.id === candidate.id,
  );
  if (!move) {
    throw new RangeError(`Illegal Nine Men's Morris move: ${candidate.id}`);
  }
  return applyGeneratedMove(position, move);
}

function applyGeneratedMove(
  position: MorrisPosition,
  move: MorrisMove,
): MorrisPosition {
  const board = applyBaseAction(position.board, position.turn, move);
  if (move.remove !== null) board[move.remove] = EMPTY;
  const placed = move.kind === "place";
  return {
    board,
    turn: otherPlayer(position.turn),
    selfToPlace:
      placed && position.turn === SELF
        ? position.selfToPlace - 1
        : position.selfToPlace,
    opponentToPlace:
      placed && position.turn === OPPONENT
        ? position.opponentToPlace - 1
        : position.opponentToPlace,
    ply: (position.ply ?? 0) + 1,
  };
}

function applyBaseAction(
  source: readonly MorrisCell[],
  player: Player,
  action: Pick<BaseAction, "from" | "to">,
): MorrisCell[] {
  const board = [...source];
  if (action.from !== null) board[action.from] = EMPTY;
  board[action.to] = player;
  return board;
}

export function getGameStatus(position: MorrisPosition): GameStatus {
  assertPosition(position);
  const selfPieces = countPieces(position, SELF);
  const opponentPieces = countPieces(position, OPPONENT);
  const statusBase = {
    selfPieces,
    opponentPieces,
    selfToPlace: position.selfToPlace,
    opponentToPlace: position.opponentToPlace,
  };

  // A player cannot lose on material or mobility while either reserve still
  // contains pieces; those men have not entered play yet.
  if (position.selfToPlace > 0 || position.opponentToPlace > 0) {
    return { state: "playing", winner: null, reason: null, ...statusBase };
  }

  const currentPieces = position.turn === SELF ? selfPieces : opponentPieces;
  if (currentPieces < 3) {
    return {
      state: "won",
      winner: otherPlayer(position.turn),
      reason: "fewer-than-three",
      ...statusBase,
    };
  }
  if (generateBaseActions(position).length === 0) {
    return {
      state: "won",
      winner: otherPlayer(position.turn),
      reason: "immobilization",
      ...statusBase,
    };
  }
  return { state: "playing", winner: null, reason: null, ...statusBase };
}

/** A deterministic static score; positive values favor `perspective`. */
export function evaluatePosition(
  position: MorrisPosition,
  perspective: Player = position.turn,
): number {
  const status = getGameStatus(position);
  if (status.state === "won") {
    return status.winner === perspective ? MATE_SCORE : -MATE_SCORE;
  }

  const enemy = otherPlayer(perspective);
  const ownTotal =
    countPieces(position, perspective) + getPiecesToPlace(position, perspective);
  const enemyTotal = countPieces(position, enemy) + getPiecesToPlace(position, enemy);
  let score = (ownTotal - enemyTotal) * 120;
  score += (countMills(position, perspective) - countMills(position, enemy)) * 34;
  score +=
    (countOpenMills(position.board, perspective) -
      countOpenMills(position.board, enemy)) *
    22;
  score +=
    (countForks(position.board, perspective) -
      countForks(position.board, enemy)) *
    14;

  if (position.selfToPlace === 0 && position.opponentToPlace === 0) {
    score +=
      (countDestinations(position, perspective) -
        countDestinations(position, enemy)) *
      3;
    score +=
      (countBlockedPieces(position, enemy) -
        countBlockedPieces(position, perspective)) *
      8;
  }
  return score;
}

function countOpenMills(board: readonly MorrisCell[], player: Player): number {
  let count = 0;
  for (const mill of MILLS) {
    let own = 0;
    let empty = 0;
    for (const point of mill) {
      if (board[point] === player) own += 1;
      else if (board[point] === EMPTY) empty += 1;
    }
    if (own === 2 && empty === 1) count += 1;
  }
  return count;
}

function countForks(board: readonly MorrisCell[], player: Player): number {
  let count = 0;
  for (let point = 0; point < MORRIS_BOARD_SIZE; point += 1) {
    if (board[point] !== EMPTY) continue;
    let threats = 0;
    for (const millIndex of MILLS_BY_POINT[point]) {
      const mill = MILLS[millIndex];
      if (mill.filter((index) => board[index] === player).length === 2) {
        threats += 1;
      }
    }
    if (threats > 1) count += threats - 1;
  }
  return count;
}

function countDestinations(position: MorrisPosition, player: Player): number {
  const pieces = countPieces(position, player);
  const empties = MORRIS_BOARD_SIZE - countPieces(position, SELF) - countPieces(position, OPPONENT);
  if (pieces === 3) return pieces * empties;
  let count = 0;
  for (let point = 0; point < MORRIS_BOARD_SIZE; point += 1) {
    if (position.board[point] !== player) continue;
    count += ADJACENCY[point].filter((to) => position.board[to] === EMPTY).length;
  }
  return count;
}

function countBlockedPieces(position: MorrisPosition, player: Player): number {
  if (countPieces(position, player) === 3) return 0;
  let blocked = 0;
  for (let point = 0; point < MORRIS_BOARD_SIZE; point += 1) {
    if (
      position.board[point] === player &&
      ADJACENCY[point].every((to) => position.board[to] !== EMPTY)
    ) {
      blocked += 1;
    }
  }
  return blocked;
}

const MATE_SCORE = 1_000_000;
const INF = MATE_SCORE + 100_000;

type Bound = "exact" | "lower" | "upper";

interface TableEntry {
  readonly depth: number;
  readonly score: number;
  readonly bound: Bound;
  readonly bestMoveId: string | null;
}

interface SearchContext {
  readonly startedAt: number;
  readonly deadline: number;
  readonly shouldStop: () => boolean;
  readonly table: Map<string, TableEntry>;
  readonly maxTableEntries: number;
  nodes: number;
}

interface NodeResult {
  readonly score: number;
  readonly pv: MorrisMove[];
}

class SearchStopped extends Error {}

/** Iterative-deepening alpha-beta search with top-N root analysis. */
export function searchBestMoves(
  position: MorrisPosition,
  options: SearchOptions = {},
  onProgress?: SearchProgressCallback,
): SearchResult {
  assertPosition(position);
  const timeMs = Math.max(1, options.timeMs ?? 1500);
  const maxDepth = Math.max(1, Math.floor(options.maxDepth ?? 8));
  const topN = Math.max(1, Math.floor(options.topN ?? 3));
  const startedAt = now();
  const context: SearchContext = {
    startedAt,
    deadline: startedAt + timeMs,
    shouldStop: options.shouldStop ?? (() => false),
    table: new Map(),
    maxTableEntries: Math.max(1000, options.maxTableEntries ?? 120_000),
    nodes: 0,
  };

  const legal = generateLegalMoves(position);
  if (legal.length === 0) {
    const elapsed = Math.max(0, now() - startedAt);
    return {
      bestMove: null,
      completed: true,
      timedOut: false,
      depth: 0,
      nodes: 0,
      timeMs: elapsed,
      nps: 0,
      score: evaluatePosition(position, position.turn),
      pv: [],
      topMoves: [],
    };
  }

  // Always provide a legal fallback, even under an exceptionally short budget.
  let completedDepth = 0;
  let completedLines = rankFallback(position, legal).slice(0, topN);
  let stopped = false;

  for (let depth = 1; depth <= maxDepth; depth += 1) {
    try {
      checkStopped(context, true);
      const lines = searchRoot(position, legal, depth, context);
      completedDepth = depth;
      completedLines = lines.slice(0, topN);
      const progress = makeProgress(
        completedDepth,
        context,
        completedLines,
      );
      onProgress?.(progress);
    } catch (error) {
      if (!(error instanceof SearchStopped)) throw error;
      stopped = true;
      break;
    }
  }

  const progress = makeProgress(completedDepth, context, completedLines);
  const timedOut = now() >= context.deadline;
  return {
    ...progress,
    bestMove: completedLines[0]?.move ?? null,
    completed: !stopped && completedDepth >= maxDepth,
    timedOut,
  };
}

function searchRoot(
  position: MorrisPosition,
  legal: readonly MorrisMove[],
  depth: number,
  context: SearchContext,
): SearchLine[] {
  const rootKey = hashPosition(position);
  const preferred = context.table.get(rootKey)?.bestMoveId ?? null;
  const ordered = orderMoves(legal, preferred);
  const lines: SearchLine[] = [];

  for (const move of ordered) {
    checkStopped(context, true);
    const child = applyGeneratedMove(position, move);
    const result = negamax(child, depth - 1, -INF, INF, context, 1);
    lines.push({ move, score: -result.score, pv: [move, ...result.pv] });
  }

  lines.sort(compareSearchLines);
  if (lines[0]) {
    storeTable(context, rootKey, {
      depth,
      score: lines[0].score,
      bound: "exact",
      bestMoveId: lines[0].move.id,
    });
  }
  return lines;
}

function negamax(
  position: MorrisPosition,
  depth: number,
  alphaInput: number,
  beta: number,
  context: SearchContext,
  distanceFromRoot: number,
): NodeResult {
  context.nodes += 1;
  checkStopped(context, context.nodes % 256 === 0);

  const status = getGameStatus(position);
  if (status.state === "won") {
    // Prefer a quicker win and postpone an unavoidable loss.
    const score =
      status.winner === position.turn
        ? MATE_SCORE - distanceFromRoot
        : -MATE_SCORE + distanceFromRoot;
    return { score, pv: [] };
  }
  if (depth <= 0) {
    return { score: evaluatePosition(position, position.turn), pv: [] };
  }

  const key = hashPosition(position);
  const entry = context.table.get(key);
  let alpha = alphaInput;
  if (entry && entry.depth >= depth) {
    if (entry.bound === "exact") return { score: entry.score, pv: [] };
    if (entry.bound === "lower") alpha = Math.max(alpha, entry.score);
    else beta = Math.min(beta, entry.score);
    if (alpha >= beta) return { score: entry.score, pv: [] };
  }

  const alphaOriginal = alpha;
  const moves = orderMoves(generateLegalMoves(position), entry?.bestMoveId ?? null);
  let bestScore = -INF;
  let bestMove: MorrisMove | null = null;
  let bestPv: MorrisMove[] = [];

  for (const move of moves) {
    const child = applyGeneratedMove(position, move);
    const result = negamax(
      child,
      depth - 1,
      -beta,
      -alpha,
      context,
      distanceFromRoot + 1,
    );
    const score = -result.score;
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
      bestPv = [move, ...result.pv];
    }
    alpha = Math.max(alpha, score);
    if (alpha >= beta) break;
  }

  const bound: Bound =
    bestScore <= alphaOriginal
      ? "upper"
      : bestScore >= beta
        ? "lower"
        : "exact";
  storeTable(context, key, {
    depth,
    score: bestScore,
    bound,
    bestMoveId: bestMove?.id ?? null,
  });
  return { score: bestScore, pv: bestPv };
}

function orderMoves(
  moves: readonly MorrisMove[],
  preferredId: string | null,
): MorrisMove[] {
  return [...moves].sort((a, b) => {
    if (a.id === preferredId) return -1;
    if (b.id === preferredId) return 1;
    if (a.remove !== null && b.remove === null) return -1;
    if (b.remove !== null && a.remove === null) return 1;
    const aCentral = ADJACENCY[a.to].length;
    const bCentral = ADJACENCY[b.to].length;
    return bCentral - aCentral || a.id.localeCompare(b.id);
  });
}

function rankFallback(
  position: MorrisPosition,
  moves: readonly MorrisMove[],
): SearchLine[] {
  return moves
    .map((move) => ({
      move,
      score: -evaluatePosition(
        applyGeneratedMove(position, move),
        otherPlayer(position.turn),
      ),
      pv: [move],
    }))
    .sort(compareSearchLines);
}

function compareSearchLines(a: SearchLine, b: SearchLine): number {
  return b.score - a.score || a.move.id.localeCompare(b.move.id);
}

function makeProgress(
  depth: number,
  context: SearchContext,
  lines: readonly SearchLine[],
): SearchProgress {
  const elapsed = Math.max(0, now() - context.startedAt);
  return {
    depth,
    nodes: context.nodes,
    timeMs: elapsed,
    nps: elapsed > 0 ? Math.round((context.nodes * 1000) / elapsed) : 0,
    score: lines[0]?.score ?? 0,
    pv: lines[0]?.pv ?? [],
    topMoves: lines,
  };
}

function hashPosition(position: MorrisPosition): string {
  let board = "";
  for (const cell of position.board) board += cell === SELF ? "2" : cell === OPPONENT ? "1" : "0";
  return `${board}:${position.turn}:${position.selfToPlace}:${position.opponentToPlace}`;
}

function storeTable(
  context: SearchContext,
  key: string,
  entry: TableEntry,
): void {
  if (context.table.size >= context.maxTableEntries && !context.table.has(key)) {
    // Map preserves insertion order; dropping the oldest quarter keeps pauses
    // rare while bounding memory in long browser sessions.
    const removeCount = Math.max(1, Math.floor(context.maxTableEntries / 4));
    let removed = 0;
    for (const oldKey of context.table.keys()) {
      context.table.delete(oldKey);
      removed += 1;
      if (removed >= removeCount) break;
    }
  }
  context.table.set(key, entry);
}

function checkStopped(context: SearchContext, checkClock: boolean): void {
  if (context.shouldStop() || (checkClock && now() >= context.deadline)) {
    throw new SearchStopped();
  }
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function boardFrom(
  positionOrBoard: MorrisPosition | readonly MorrisCell[],
): readonly MorrisCell[] {
  // Array.isArray's built-in predicate does not narrow readonly arrays.
  return Array.isArray(positionOrBoard)
    ? (positionOrBoard as readonly MorrisCell[])
    : (positionOrBoard as MorrisPosition).board;
}

function assertIndex(index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= MORRIS_BOARD_SIZE) {
    throw new RangeError(`Invalid Nine Men's Morris point: ${index}`);
  }
}

function assertPosition(position: MorrisPosition): void {
  if (position.board.length !== MORRIS_BOARD_SIZE) {
    throw new RangeError(
      `Nine Men's Morris board must contain ${MORRIS_BOARD_SIZE} points`,
    );
  }
  if (position.turn !== SELF && position.turn !== OPPONENT) {
    throw new RangeError(`Invalid player to move: ${position.turn}`);
  }
  for (const value of [position.selfToPlace, position.opponentToPlace]) {
    if (!Number.isInteger(value) || value < 0 || value > PIECES_PER_PLAYER) {
      throw new RangeError(`Invalid reserve count: ${value}`);
    }
  }
  for (const cell of position.board) {
    if (cell !== SELF && cell !== OPPONENT && cell !== EMPTY) {
      throw new RangeError(`Invalid board cell: ${cell}`);
    }
  }
}
