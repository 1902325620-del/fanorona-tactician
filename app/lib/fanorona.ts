/**
 * Fanorona (Fanoron-Tsivy) rules and search engine.
 *
 * Board indices run left-to-right, top-to-bottom. Thus index 0 is a5 and
 * index 44 is i1. The opponent occupies the top as -1, while the assisted
 * player occupies the bottom as +1.
 */

export const BOARD_ROWS = 5;
export const BOARD_COLS = 9;
export const BOARD_SIZE = BOARD_ROWS * BOARD_COLS;

export const SELF = 1 as const;
export const OPPONENT = -1 as const;
export const EMPTY = 0 as const;

export type Player = typeof SELF | typeof OPPONENT;
export type Cell = Player | typeof EMPTY;
export type CaptureKind = "approach" | "withdrawal";

export interface BoardPoint {
  /** Zero based, top-to-bottom. Row 0 is algebraic row 5. */
  row: number;
  /** Zero based, left-to-right. Column 0 is algebraic file a. */
  col: number;
}

export interface Direction {
  dr: -1 | 0 | 1;
  dc: -1 | 0 | 1;
}

export interface MoveStep {
  /** Board index, 0 (a5) through 44 (i1). */
  from: number;
  /** Board index, 0 (a5) through 44 (i1). */
  to: number;
  capture: CaptureKind | null;
  /** Captured indices in order, nearest first. */
  captured: number[];
  direction: Direction;
}

export interface TurnMove {
  /** Stable structural id, suitable for React keys and worker round-trips. */
  id: string;
  player: Player;
  steps: MoveStep[];
  from: number;
  to: number;
  isCapture: boolean;
  captured: number[];
  captureCount: number;
  /** For example `f2-e3A` or `d3-e3A,e3-f4W`. */
  notation: string;
}

export interface FanoronaPosition {
  board: Cell[];
  turn: Player;
  /** Optional for hand-edited positions; generated positions always set it. */
  ply?: number;
}

/** Concise UI-facing aliases. */
export type Position = FanoronaPosition;
export type Step = MoveStep;

export type GameEndReason = "elimination" | "immobilization";

export interface GameStatus {
  state: "playing" | "won";
  winner: Player | null;
  reason: GameEndReason | null;
  selfPieces: number;
  opponentPieces: number;
}

export interface SearchOptions {
  /** Hard thinking budget in milliseconds. Defaults to 1800. */
  timeMs?: number;
  /** Maximum completed full-turn depth. Defaults to 12. */
  maxDepth?: number;
  /** Number of independently scored root choices. Defaults to 3. */
  topN?: number;
  /** Maximum tactical capture extension after the nominal horizon. */
  quiescenceDepth?: number;
  /** Maximum transposition-table entries retained by this search. */
  maxTableEntries?: number;
  /** Optional cooperative stop hook for non-worker callers. */
  shouldStop?: () => boolean;
}

export interface SearchLine {
  move: TurnMove;
  score: number;
  pv: TurnMove[];
  /** True for a proven-draw opening-book move in the initial position. */
  openingBook: boolean;
}

export interface SearchProgress {
  depth: number;
  nodes: number;
  timeMs: number;
  nps: number;
  score: number;
  pv: TurnMove[];
  topMoves: SearchLine[];
}

export interface SearchResult extends SearchProgress {
  bestMove: TurnMove | null;
  completed: boolean;
  timedOut: boolean;
}

export type SearchProgressCallback = (progress: SearchProgress) => void;

const ORTHOGONAL_DIRECTIONS: readonly Direction[] = [
  { dr: -1, dc: 0 },
  { dr: 0, dc: 1 },
  { dr: 1, dc: 0 },
  { dr: 0, dc: -1 },
];

const DIAGONAL_DIRECTIONS: readonly Direction[] = [
  { dr: -1, dc: -1 },
  { dr: -1, dc: 1 },
  { dr: 1, dc: 1 },
  { dr: 1, dc: -1 },
];

export const ALL_DIRECTIONS: readonly Direction[] = [
  ...ORTHOGONAL_DIRECTIONS,
  ...DIAGONAL_DIRECTIONS,
];

const INITIAL_BOARD: readonly Cell[] = [
  // a5 .. i5
  -1, -1, -1, -1, -1, -1, -1, -1, -1,
  // a4 .. i4
  -1, -1, -1, -1, -1, -1, -1, -1, -1,
  // a3 .. i3
  -1, 1, -1, 1, 0, -1, 1, -1, 1,
  // a2 .. i2
  1, 1, 1, 1, 1, 1, 1, 1, 1,
  // a1 .. i1
  1, 1, 1, 1, 1, 1, 1, 1, 1,
];

/**
 * Creates the standard 22-vs-22 setup. The opponent moves first by default,
 * matching the assistant's default workflow; pass `SELF` for orthodox White.
 */
export function createInitialPosition(
  turn: Player = OPPONENT,
): FanoronaPosition {
  return { board: [...INITIAL_BOARD], turn, ply: 0 };
}

export function otherPlayer(player: Player): Player {
  return player === SELF ? OPPONENT : SELF;
}

export function pointToIndex(point: BoardPoint): number {
  const { row, col } = point;
  if (!Number.isInteger(row) || !Number.isInteger(col) || !isOnBoard(row, col)) {
    throw new RangeError(`Invalid Fanorona point (${row}, ${col})`);
  }
  return row * BOARD_COLS + col;
}

export function indexToPoint(index: number): BoardPoint {
  assertIndex(index);
  return {
    row: Math.floor(index / BOARD_COLS),
    col: index % BOARD_COLS,
  };
}

/** Converts an index to a coordinate such as `a5`, `e3`, or `i1`. */
export function indexToAlgebraic(index: number): string {
  const { row, col } = indexToPoint(index);
  return `${String.fromCharCode(97 + col)}${BOARD_ROWS - row}`;
}

export function pointToAlgebraic(point: BoardPoint): string {
  return indexToAlgebraic(pointToIndex(point));
}

export function algebraicToPoint(value: string): BoardPoint {
  const match = /^([a-i])([1-5])$/i.exec(value.trim());
  if (!match) {
    throw new RangeError(`Invalid Fanorona coordinate: ${value}`);
  }
  return {
    row: BOARD_ROWS - Number(match[2]),
    col: match[1].toLowerCase().charCodeAt(0) - 97,
  };
}

export function algebraicToIndex(value: string): number {
  return pointToIndex(algebraicToPoint(value));
}

/** Strong intersections are the points carrying diagonal board lines. */
export function isStrongPoint(indexOrPoint: number | BoardPoint): boolean {
  const point =
    typeof indexOrPoint === "number"
      ? indexToPoint(indexOrPoint)
      : indexOrPoint;
  return (point.row + point.col) % 2 === 0;
}

export function areConnected(from: number, to: number): boolean {
  const a = indexToPoint(from);
  const b = indexToPoint(to);
  const dr = b.row - a.row;
  const dc = b.col - a.col;
  if (Math.max(Math.abs(dr), Math.abs(dc)) !== 1 || (dr === 0 && dc === 0)) {
    return false;
  }
  return dr === 0 || dc === 0 || isStrongPoint(a);
}

export function formatStep(step: MoveStep): string {
  const suffix =
    step.capture === "approach"
      ? "A"
      : step.capture === "withdrawal"
        ? "W"
        : "P";
  return `${indexToAlgebraic(step.from)}-${indexToAlgebraic(step.to)}${suffix}`;
}

export function formatMove(move: Pick<TurnMove, "steps">): string {
  return move.steps.map(formatStep).join(",");
}

export function moveId(move: Pick<TurnMove, "steps">): string {
  return move.steps
    .map((step) => {
      const kind =
        step.capture === "approach"
          ? "a"
          : step.capture === "withdrawal"
            ? "w"
            : "p";
      return `${step.from}.${step.to}.${kind}`;
    })
    .join("/");
}

/** Returns all legal complete turns, including every legal early-stop prefix. */
export function generateLegalMoves(position: FanoronaPosition): TurnMove[] {
  assertPosition(position);
  return generateLegalMovesForBoard(position.board, position.turn);
}

export function generateLegalMovesForBoard(
  board: readonly Cell[],
  player: Player,
): TurnMove[] {
  assertBoard(board);
  assertPlayer(player);

  const mutableBoard = [...board];
  const firstCaptures: Array<{ from: number; step: MoveStep }> = [];

  for (let from = 0; from < BOARD_SIZE; from += 1) {
    if (mutableBoard[from] !== player) continue;
    for (const step of captureStepsFrom(mutableBoard, player, from)) {
      firstCaptures.push({ from, step });
    }
  }

  if (firstCaptures.length > 0) {
    const moves: TurnMove[] = [];
    for (const { from, step } of firstCaptures) {
      const undo = applyStepInPlace(mutableBoard, step, player);
      const visited = new Set<number>([from, step.to]);
      expandCaptureTurn(mutableBoard, player, [step], visited, moves);
      undoStepInPlace(mutableBoard, undo);
    }
    return moves;
  }

  const moves: TurnMove[] = [];
  for (let from = 0; from < BOARD_SIZE; from += 1) {
    if (mutableBoard[from] !== player) continue;
    const origin = indexToPoint(from);
    for (const direction of ALL_DIRECTIONS) {
      const to = adjacentIndex(origin, direction);
      if (to < 0 || mutableBoard[to] !== EMPTY || !areConnectedFast(from, to)) {
        continue;
      }
      const step: MoveStep = {
        from,
        to,
        capture: null,
        captured: [],
        direction: { ...direction },
      };
      moves.push(makeTurnMove(player, [step]));
    }
  }
  return moves;
}

/**
 * Legal next capture steps for an in-progress turn. The initial occupied point
 * should be included in `visited` so returning to it is correctly forbidden.
 */
export function generateCaptureContinuations(
  board: readonly Cell[],
  player: Player,
  from: number,
  visited: ReadonlySet<number> | readonly number[],
  lastDirection: Direction,
): MoveStep[] {
  assertBoard(board);
  assertPlayer(player);
  assertIndex(from);
  const visitedSet =
    visited instanceof Set ? visited : new Set<number>(visited);
  return captureStepsFrom(board, player, from, lastDirection, visitedSet);
}

/**
 * Applies one generated step immutably. This is useful while displaying an
 * opponent's multi-capture turn before committing the whole turn.
 */
export function applyStep(
  board: readonly Cell[],
  step: MoveStep,
  side: Player,
): Cell[] {
  assertBoard(board);
  assertPlayer(side);
  validateStepAgainstBoard(board, step, side);
  const next = [...board];
  applyStepInPlace(next, step, side);
  return next;
}

/** Applies a legal complete turn and switches the player to move. */
export function applyMove(
  position: FanoronaPosition,
  move: TurnMove,
): FanoronaPosition {
  assertPosition(position);
  const id = moveId(move);
  const legalMove = generateLegalMoves(position).find((candidate) => candidate.id === id);
  if (!legalMove) {
    throw new Error(`Illegal Fanorona turn: ${formatMove(move)}`);
  }
  return applyMoveUnchecked(position, legalMove);
}

/** Fast path for moves returned by `generateLegalMoves`. */
export function applyMoveUnchecked(
  position: FanoronaPosition,
  move: TurnMove,
): FanoronaPosition {
  const board = [...position.board];
  for (const step of move.steps) {
    applyStepInPlace(board, step, position.turn);
  }
  return {
    board,
    turn: otherPlayer(position.turn),
    ply: (position.ply ?? 0) + 1,
  };
}

/** Finds generated turns matching an entered path and optional capture modes. */
export function findMovesByPath(
  position: FanoronaPosition,
  path: readonly (number | BoardPoint | string)[],
  captures?: readonly (CaptureKind | null)[],
): TurnMove[] {
  if (path.length < 2) return [];
  const indices = path.map(coordinateToIndex);
  return generateLegalMoves(position).filter((move) => {
    if (move.steps.length !== indices.length - 1) return false;
    if (move.steps[0].from !== indices[0]) return false;
    for (let index = 0; index < move.steps.length; index += 1) {
      const step = move.steps[index];
      if (step.to !== indices[index + 1]) return false;
      if (captures && captures[index] !== undefined && step.capture !== captures[index]) {
        return false;
      }
    }
    return true;
  });
}

export function getGameStatus(position: FanoronaPosition): GameStatus {
  assertPosition(position);
  let selfPieces = 0;
  let opponentPieces = 0;
  for (const cell of position.board) {
    if (cell === SELF) selfPieces += 1;
    if (cell === OPPONENT) opponentPieces += 1;
  }
  if (selfPieces === 0 || opponentPieces === 0) {
    return {
      state: "won",
      winner: selfPieces === 0 ? OPPONENT : SELF,
      reason: "elimination",
      selfPieces,
      opponentPieces,
    };
  }
  if (generateLegalMoves(position).length === 0) {
    return {
      state: "won",
      winner: otherPlayer(position.turn),
      reason: "immobilization",
      selfPieces,
      opponentPieces,
    };
  }
  return {
    state: "playing",
    winner: null,
    reason: null,
    selfPieces,
    opponentPieces,
  };
}

export function isInitialPosition(position: FanoronaPosition): boolean {
  if (position.board.length !== BOARD_SIZE) return false;
  for (let index = 0; index < BOARD_SIZE; index += 1) {
    if (position.board[index] !== INITIAL_BOARD[index]) return false;
  }
  return true;
}

/**
 * Proven-draw opening moves. The -1 entries are the 180-degree symmetric
 * equivalents used when the top opponent is entered as the first player.
 */
export const SOLVED_OPENINGS: Readonly<Record<Player, readonly string[]>> = {
  [SELF]: ["f2-e3A", "d3-e3A"],
  [OPPONENT]: ["d4-e3A", "f3-e3A"],
};

export function getSolvedOpeningMoves(position: FanoronaPosition): TurnMove[] {
  if (!isInitialPosition(position)) return [];
  const priorities = SOLVED_OPENINGS[position.turn];
  const rank = new Map(priorities.map((notation, index) => [notation, index]));
  return generateLegalMoves(position)
    .filter((move) => move.steps.length === 1 && rank.has(move.notation))
    .sort((a, b) => (rank.get(a.notation) ?? 99) - (rank.get(b.notation) ?? 99));
}

interface UndoRecord {
  from: number;
  to: number;
  captured: number[];
  side: Player;
}

function expandCaptureTurn(
  board: Cell[],
  player: Player,
  steps: MoveStep[],
  visited: Set<number>,
  output: TurnMove[],
): void {
  // Continuing a capture is optional, so every non-empty prefix is a full turn.
  output.push(makeTurnMove(player, steps));

  const last = steps[steps.length - 1];
  const continuations = captureStepsFrom(
    board,
    player,
    last.to,
    last.direction,
    visited,
  );
  for (const step of continuations) {
    const undo = applyStepInPlace(board, step, player);
    visited.add(step.to);
    steps.push(step);
    expandCaptureTurn(board, player, steps, visited, output);
    steps.pop();
    visited.delete(step.to);
    undoStepInPlace(board, undo);
  }
}

function captureStepsFrom(
  board: readonly Cell[],
  player: Player,
  from: number,
  lastDirection?: Direction,
  visited?: ReadonlySet<number>,
): MoveStep[] {
  const origin = indexToPointFast(from);
  const result: MoveStep[] = [];

  for (const direction of ALL_DIRECTIONS) {
    if (
      lastDirection &&
      direction.dr === lastDirection.dr &&
      direction.dc === lastDirection.dc
    ) {
      continue;
    }
    const to = adjacentIndex(origin, direction);
    if (
      to < 0 ||
      board[to] !== EMPTY ||
      !areConnectedFast(from, to) ||
      visited?.has(to)
    ) {
      continue;
    }

    const approach = collectCaptureLine(
      board,
      player,
      to,
      direction.dr,
      direction.dc,
    );
    if (approach.length > 0) {
      result.push({
        from,
        to,
        capture: "approach",
        captured: approach,
        direction: { ...direction },
      });
    }

    const withdrawal = collectCaptureLine(
      board,
      player,
      from,
      -direction.dr,
      -direction.dc,
    );
    if (withdrawal.length > 0) {
      result.push({
        from,
        to,
        capture: "withdrawal",
        captured: withdrawal,
        direction: { ...direction },
      });
    }
  }
  return result;
}

function collectCaptureLine(
  board: readonly Cell[],
  player: Player,
  anchor: number,
  dr: number,
  dc: number,
): number[] {
  const captured: number[] = [];
  let previous = anchor;
  let point = indexToPointFast(anchor);

  while (true) {
    const row = point.row + dr;
    const col = point.col + dc;
    if (!isOnBoard(row, col)) break;
    const next = row * BOARD_COLS + col;
    if (!areConnectedFast(previous, next) || board[next] !== -player) break;
    captured.push(next);
    previous = next;
    point = { row, col };
  }
  return captured;
}

function applyStepInPlace(
  board: Cell[],
  step: MoveStep,
  side: Player,
): UndoRecord {
  board[step.from] = EMPTY;
  board[step.to] = side;
  for (const captured of step.captured) board[captured] = EMPTY;
  return {
    from: step.from,
    to: step.to,
    captured: step.captured,
    side,
  };
}

function undoStepInPlace(board: Cell[], undo: UndoRecord): void {
  board[undo.to] = EMPTY;
  board[undo.from] = undo.side;
  for (const captured of undo.captured) board[captured] = otherPlayer(undo.side);
}

function validateStepAgainstBoard(
  board: readonly Cell[],
  step: MoveStep,
  side: Player,
): void {
  assertIndex(step.from);
  assertIndex(step.to);
  if (board[step.from] !== side) {
    throw new Error(`No ${side} piece at ${indexToAlgebraic(step.from)}`);
  }
  if (board[step.to] !== EMPTY || !areConnected(step.from, step.to)) {
    throw new Error(`Illegal step ${indexToAlgebraic(step.from)}-${indexToAlgebraic(step.to)}`);
  }
  const from = indexToPointFast(step.from);
  const to = indexToPointFast(step.to);
  const direction: Direction = {
    dr: Math.sign(to.row - from.row) as Direction["dr"],
    dc: Math.sign(to.col - from.col) as Direction["dc"],
  };
  const approach = collectCaptureLine(board, side, step.to, direction.dr, direction.dc);
  const withdrawal = collectCaptureLine(board, side, step.from, -direction.dr, -direction.dc);
  const expected =
    step.capture === "approach"
      ? approach
      : step.capture === "withdrawal"
        ? withdrawal
        : [];

  if (step.capture === null && (approach.length > 0 || withdrawal.length > 0)) {
    throw new Error("A capturing step cannot be entered as a paika move");
  }
  if (step.capture !== null && expected.length === 0) {
    throw new Error(`Step does not capture by ${step.capture}`);
  }
  if (!sameIndices(expected, step.captured)) {
    throw new Error("Step.captured does not match the board position");
  }
}

function makeTurnMove(player: Player, inputSteps: readonly MoveStep[]): TurnMove {
  const steps = inputSteps.map((step) => ({
    ...step,
    captured: [...step.captured],
    direction: { ...step.direction },
  }));
  const captured = steps.flatMap((step) => step.captured);
  const shell = { steps };
  return {
    id: moveId(shell),
    player,
    steps,
    from: steps[0].from,
    to: steps[steps.length - 1].to,
    isCapture: captured.length > 0,
    captured,
    captureCount: captured.length,
    notation: formatMove(shell),
  };
}

function coordinateToIndex(value: number | BoardPoint | string): number {
  if (typeof value === "number") {
    assertIndex(value);
    return value;
  }
  return typeof value === "string" ? algebraicToIndex(value) : pointToIndex(value);
}

function adjacentIndex(origin: BoardPoint, direction: Direction): number {
  const row = origin.row + direction.dr;
  const col = origin.col + direction.dc;
  return isOnBoard(row, col) ? row * BOARD_COLS + col : -1;
}

function areConnectedFast(from: number, to: number): boolean {
  const fromRow = Math.floor(from / BOARD_COLS);
  const fromCol = from % BOARD_COLS;
  const toRow = Math.floor(to / BOARD_COLS);
  const toCol = to % BOARD_COLS;
  const dr = Math.abs(toRow - fromRow);
  const dc = Math.abs(toCol - fromCol);
  if (Math.max(dr, dc) !== 1 || (dr === 0 && dc === 0)) return false;
  return dr === 0 || dc === 0 || (fromRow + fromCol) % 2 === 0;
}

function indexToPointFast(index: number): BoardPoint {
  return { row: Math.floor(index / BOARD_COLS), col: index % BOARD_COLS };
}

function isOnBoard(row: number, col: number): boolean {
  return row >= 0 && row < BOARD_ROWS && col >= 0 && col < BOARD_COLS;
}

function sameIndices(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function assertIndex(index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= BOARD_SIZE) {
    throw new RangeError(`Invalid Fanorona board index: ${index}`);
  }
}

function assertPlayer(player: number): asserts player is Player {
  if (player !== SELF && player !== OPPONENT) {
    throw new RangeError(`Invalid Fanorona player: ${player}`);
  }
}

function assertBoard(board: readonly number[]): asserts board is readonly Cell[] {
  if (board.length !== BOARD_SIZE) {
    throw new RangeError(`A Fanorona board must have ${BOARD_SIZE} cells`);
  }
  for (const cell of board) {
    if (cell !== EMPTY && cell !== SELF && cell !== OPPONENT) {
      throw new RangeError(`Invalid Fanorona cell value: ${cell}`);
    }
  }
}

function assertPosition(position: FanoronaPosition): void {
  assertBoard(position.board);
  assertPlayer(position.turn);
}

// ---------------------------------------------------------------------------
// Search engine
// ---------------------------------------------------------------------------

const WIN_SCORE = 1_000_000;
const MATE_THRESHOLD = WIN_SCORE - 10_000;
const INF = WIN_SCORE + 100_000;

type TTFlag = "exact" | "lower" | "upper";

interface TTEntry {
  lock: number;
  depth: number;
  score: number;
  flag: TTFlag;
  bestMoveId: string | null;
}

interface SearchState {
  board: Cell[];
  turn: Player;
  hash: number;
  lock: number;
}

interface SearchContext {
  startedAt: number;
  deadline: number;
  nodes: number;
  qDepth: number;
  maxTableEntries: number;
  shouldStop?: () => boolean;
  tt: Map<number, TTEntry>;
  history: Map<string, number>;
  killers: Array<[string | null, string | null]>;
  pathHashes: number[];
  pathLocks: number[];
}

interface RootScore {
  move: TurnMove;
  score: number;
  pv: TurnMove[];
  openingBook: boolean;
}

class SearchStopped extends Error {}

const ZOBRIST_HASH: number[][] = [];
const ZOBRIST_LOCK: number[][] = [];
let randomSeed = 0x7f4a7c15;

function nextRandom32(): number {
  randomSeed ^= randomSeed << 13;
  randomSeed ^= randomSeed >>> 17;
  randomSeed ^= randomSeed << 5;
  return randomSeed >>> 0;
}

for (let index = 0; index < BOARD_SIZE; index += 1) {
  ZOBRIST_HASH.push([nextRandom32(), nextRandom32()]);
  ZOBRIST_LOCK.push([nextRandom32(), nextRandom32()]);
}
const ZOBRIST_SIDE_HASH = nextRandom32();
const ZOBRIST_SIDE_LOCK = nextRandom32();

/**
 * Iterative-deepening negamax with alpha-beta pruning, transposition table,
 * tactical capture quiescence, history/killer ordering, and MultiPV root lines.
 */
export function searchBestMoves(
  position: FanoronaPosition,
  options: SearchOptions = {},
  onProgress?: SearchProgressCallback,
): SearchResult {
  assertPosition(position);
  const startedAt = nowMs();
  const budget = clampInteger(options.timeMs ?? 1800, 20, 120_000);
  const maxDepth = clampInteger(options.maxDepth ?? 12, 1, 64);
  const topN = clampInteger(options.topN ?? 3, 1, 12);
  const context: SearchContext = {
    startedAt,
    deadline: startedAt + budget,
    nodes: 0,
    qDepth: clampInteger(options.quiescenceDepth ?? 2, 0, 16),
    maxTableEntries: clampInteger(options.maxTableEntries ?? 220_000, 1_000, 2_000_000),
    shouldStop: options.shouldStop,
    tt: new Map(),
    history: new Map(),
    killers: [],
    pathHashes: [],
    pathLocks: [],
  };

  const rootState = createSearchState(position.board, position.turn);
  const rootMoves = generateLegalMovesForBoard(rootState.board, rootState.turn);
  if (rootMoves.length === 0) {
    const timeMs = Math.max(0, nowMs() - startedAt);
    return {
      bestMove: null,
      topMoves: [],
      depth: 0,
      nodes: 0,
      timeMs,
      nps: 0,
      score: -WIN_SCORE,
      pv: [],
      completed: true,
      timedOut: false,
    };
  }

  const bookIds = new Map<string, number>();
  getSolvedOpeningMoves(position).forEach((move, index) => bookIds.set(move.id, index));

  let orderedRoot = [...rootMoves].sort((a, b) =>
    compareRootMoves(a, b, bookIds, null, context, 0),
  );
  let completedDepth = 0;
  let completedScores: RootScore[] = fallbackRootScores(orderedRoot, rootState, bookIds);
  let timedOut = false;

  for (let depth = 1; depth <= maxDepth; depth += 1) {
    const iteration: RootScore[] = [];
    try {
      checkSearchStop(context, true);
      orderedRoot.sort((a, b) => {
        const previousA = completedScores.find((line) => line.move.id === a.id)?.score;
        const previousB = completedScores.find((line) => line.move.id === b.id)?.score;
        if (previousA !== undefined && previousB !== undefined && previousA !== previousB) {
          return previousB - previousA;
        }
        return compareRootMoves(a, b, bookIds, null, context, 0);
      });

      context.pathHashes.length = 0;
      context.pathLocks.length = 0;
      context.pathHashes.push(rootState.hash);
      context.pathLocks.push(rootState.lock);

      for (const move of orderedRoot) {
        checkSearchStop(context, true);
        const child = applySearchMove(rootState, move);
        const score = -negamax(child, depth - 1, -INF, INF, 1, context);
        const pv = [move, ...extractPrincipalVariation(child, depth - 1, context)];
        iteration.push({
          move,
          score,
          pv,
          openingBook: bookIds.has(move.id),
        });
      }

      completedDepth = depth;
      completedScores = sortRootScores(iteration, bookIds);
      orderedRoot = completedScores.map((line) => line.move);
      const progress = makeProgress(completedDepth, completedScores, topN, context);
      onProgress?.(progress);
    } catch (error) {
      if (!(error instanceof SearchStopped)) throw error;
      timedOut = true;
      break;
    }
  }

  const topMoves = sortRootScores(completedScores, bookIds)
    .slice(0, Math.min(topN, completedScores.length))
    .map(toSearchLine);
  const timeMs = Math.max(0, nowMs() - startedAt);
  const best = topMoves[0] ?? null;
  return {
    bestMove: best?.move ?? null,
    topMoves,
    depth: completedDepth,
    nodes: context.nodes,
    timeMs,
    nps: timeMs > 0 ? Math.round((context.nodes * 1000) / timeMs) : 0,
    score: best?.score ?? -WIN_SCORE,
    pv: best?.pv ?? [],
    completed: !timedOut && completedDepth >= maxDepth,
    timedOut,
  };
}

function negamax(
  state: SearchState,
  depth: number,
  alphaInput: number,
  beta: number,
  ply: number,
  context: SearchContext,
): number {
  context.nodes += 1;
  checkSearchStop(context);

  if (isRepeatedOnPath(state, context)) return 0;

  let selfCount = 0;
  let opponentCount = 0;
  for (const cell of state.board) {
    if (cell === SELF) selfCount += 1;
    if (cell === OPPONENT) opponentCount += 1;
  }
  if (selfCount === 0 || opponentCount === 0) {
    const winner = selfCount === 0 ? OPPONENT : SELF;
    return winner === state.turn ? WIN_SCORE - ply : -WIN_SCORE + ply;
  }

  if (depth <= 0) {
    return quiescence(state, alphaInput, beta, ply, context.qDepth, context);
  }

  const alphaOriginal = alphaInput;
  let alpha = alphaInput;
  const cached = context.tt.get(state.hash);
  if (cached && cached.lock === state.lock && cached.depth >= depth) {
    const cachedScore = scoreFromTable(cached.score, ply);
    if (cached.flag === "exact") return cachedScore;
    if (cached.flag === "lower") alpha = Math.max(alpha, cachedScore);
    if (cached.flag === "upper" && cachedScore <= alpha) return cachedScore;
    if (alpha >= beta) return cachedScore;
  }

  let moves = generateLegalMovesForBoard(state.board, state.turn);
  if (moves.length === 0) return -WIN_SCORE + ply;
  moves = orderMoves(moves, cached?.bestMoveId ?? null, context, ply);

  let bestScore = -INF;
  let bestMoveId: string | null = null;
  context.pathHashes.push(state.hash);
  context.pathLocks.push(state.lock);

  try {
    for (const move of moves) {
      const child = applySearchMove(state, move);
      const score = -negamax(child, depth - 1, -beta, -alpha, ply + 1, context);
      if (score > bestScore) {
        bestScore = score;
        bestMoveId = move.id;
      }
      if (score > alpha) alpha = score;
      if (alpha >= beta) {
        recordCutoff(move, depth, ply, context);
        break;
      }
    }
  } finally {
    context.pathHashes.pop();
    context.pathLocks.pop();
  }

  const flag: TTFlag =
    bestScore <= alphaOriginal ? "upper" : bestScore >= beta ? "lower" : "exact";
  storeTableEntry(
    state,
    {
      lock: state.lock,
      depth,
      score: scoreToTable(bestScore, ply),
      flag,
      bestMoveId,
    },
    context,
  );
  return bestScore;
}

function quiescence(
  state: SearchState,
  alphaInput: number,
  beta: number,
  ply: number,
  remaining: number,
  context: SearchContext,
): number {
  context.nodes += 1;
  checkSearchStop(context);

  if (isRepeatedOnPath(state, context)) return 0;

  let selfCount = 0;
  let opponentCount = 0;
  for (const cell of state.board) {
    if (cell === SELF) selfCount += 1;
    if (cell === OPPONENT) opponentCount += 1;
  }
  if (selfCount === 0 || opponentCount === 0) {
    const winner = selfCount === 0 ? OPPONENT : SELF;
    return winner === state.turn ? WIN_SCORE - ply : -WIN_SCORE + ply;
  }

  const moves = generateLegalMovesForBoard(state.board, state.turn);
  if (moves.length === 0) return -WIN_SCORE + ply;
  const captures = moves[0]?.isCapture ? moves : [];
  if (captures.length === 0 || remaining <= 0) {
    return evaluatePosition(state.board, state.turn);
  }

  let alpha = alphaInput;
  let bestScore = -INF;
  const ordered = orderMoves(captures, null, context, ply);
  context.pathHashes.push(state.hash);
  context.pathLocks.push(state.lock);
  try {
    for (const move of ordered) {
      const child = applySearchMove(state, move);
      const score = -quiescence(child, -beta, -alpha, ply + 1, remaining - 1, context);
      if (score > bestScore) bestScore = score;
      if (score > alpha) alpha = score;
      if (alpha >= beta) break;
    }
  } finally {
    context.pathHashes.pop();
    context.pathLocks.pop();
  }
  return bestScore;
}

/** Static score from `perspective` (positive is good for that side). */
export function evaluatePosition(
  board: readonly Cell[],
  perspective: Player,
): number {
  assertBoard(board);
  assertPlayer(perspective);

  let selfPieces = 0;
  let opponentPieces = 0;
  let selfPosition = 0;
  let opponentPosition = 0;
  let selfMobility = 0;
  let opponentMobility = 0;

  for (let index = 0; index < BOARD_SIZE; index += 1) {
    const piece = board[index];
    if (piece === EMPTY) continue;
    if (piece === SELF) selfPieces += 1;
    else opponentPieces += 1;

    const point = indexToPointFast(index);
    const centerDistance = Math.abs(point.row - 2) + Math.abs(point.col - 4) * 0.35;
    const positional = Math.round(8 - centerDistance + (isStrongPointFast(index) ? 2 : 0));
    if (piece === SELF) selfPosition += positional;
    else opponentPosition += positional;

    let mobility = 0;
    for (const direction of ALL_DIRECTIONS) {
      const to = adjacentIndex(point, direction);
      if (to >= 0 && board[to] === EMPTY && areConnectedFast(index, to)) mobility += 1;
    }
    if (piece === SELF) selfMobility += mobility;
    else opponentMobility += mobility;
  }

  if (selfPieces === 0) return perspective === SELF ? -WIN_SCORE : WIN_SCORE;
  if (opponentPieces === 0) return perspective === OPPONENT ? -WIN_SCORE : WIN_SCORE;

  const remainingPieces = selfPieces + opponentPieces;
  const materialWeight = 105 + (44 - remainingPieces) * 3;
  const selfThreat = captureThreat(board, SELF);
  const opponentThreat = captureThreat(board, OPPONENT);
  const whiteScore =
    (selfPieces - opponentPieces) * materialWeight +
    (selfPosition - opponentPosition) * 2 +
    (selfMobility - opponentMobility) * 3 +
    (selfThreat.maxCaptured - opponentThreat.maxCaptured) * 19 +
    (selfThreat.options - opponentThreat.options) * 2;
  return perspective === SELF ? whiteScore : -whiteScore;
}

function captureThreat(
  board: readonly Cell[],
  player: Player,
): { maxCaptured: number; options: number } {
  let maxCaptured = 0;
  let options = 0;
  for (let index = 0; index < BOARD_SIZE; index += 1) {
    if (board[index] !== player) continue;
    for (const step of captureStepsFrom(board, player, index)) {
      options += 1;
      if (step.captured.length > maxCaptured) maxCaptured = step.captured.length;
    }
  }
  return { maxCaptured, options };
}

function fallbackRootScores(
  moves: readonly TurnMove[],
  root: SearchState,
  bookIds: ReadonlyMap<string, number>,
): RootScore[] {
  return moves.map((move) => {
    const child = applySearchMove(root, move);
    return {
      move,
      score: -evaluatePosition(child.board, child.turn),
      pv: [move],
      openingBook: bookIds.has(move.id),
    };
  });
}

function makeProgress(
  depth: number,
  scores: readonly RootScore[],
  topN: number,
  context: SearchContext,
): SearchProgress {
  const topMoves = scores.slice(0, topN).map(toSearchLine);
  const timeMs = Math.max(0, nowMs() - context.startedAt);
  return {
    depth,
    nodes: context.nodes,
    timeMs,
    nps: timeMs > 0 ? Math.round((context.nodes * 1000) / timeMs) : 0,
    score: topMoves[0]?.score ?? -WIN_SCORE,
    pv: topMoves[0]?.pv ?? [],
    topMoves,
  };
}

function toSearchLine(score: RootScore): SearchLine {
  return {
    move: score.move,
    score: score.score,
    pv: score.pv,
    openingBook: score.openingBook,
  };
}

function sortRootScores(
  scores: readonly RootScore[],
  bookIds: ReadonlyMap<string, number>,
): RootScore[] {
  return [...scores].sort((a, b) => {
    const bookA = bookIds.get(a.move.id);
    const bookB = bookIds.get(b.move.id);
    if (bookA !== undefined || bookB !== undefined) {
      if (bookA === undefined) return 1;
      if (bookB === undefined) return -1;
      if (bookA !== bookB) return bookA - bookB;
    }
    return b.score - a.score || b.move.captureCount - a.move.captureCount;
  });
}

function compareRootMoves(
  a: TurnMove,
  b: TurnMove,
  bookIds: ReadonlyMap<string, number>,
  ttMoveId: string | null,
  context: SearchContext,
  ply: number,
): number {
  return (
    moveOrderingScore(b, ttMoveId, context, ply, bookIds) -
    moveOrderingScore(a, ttMoveId, context, ply, bookIds)
  );
}

function orderMoves(
  moves: readonly TurnMove[],
  ttMoveId: string | null,
  context: SearchContext,
  ply: number,
): TurnMove[] {
  return [...moves].sort(
    (a, b) =>
      moveOrderingScore(b, ttMoveId, context, ply) -
      moveOrderingScore(a, ttMoveId, context, ply),
  );
}

function moveOrderingScore(
  move: TurnMove,
  ttMoveId: string | null,
  context: SearchContext,
  ply: number,
  bookIds?: ReadonlyMap<string, number>,
): number {
  let score = 0;
  if (move.id === ttMoveId) score += 1_000_000_000;
  const bookRank = bookIds?.get(move.id);
  if (bookRank !== undefined) score += 900_000_000 - bookRank * 1_000;
  score += move.captureCount * 100_000 + move.steps.length * 1_000;
  const destination = indexToPointFast(move.to);
  score += Math.round(100 - (Math.abs(destination.row - 2) + Math.abs(destination.col - 4)) * 5);
  if (isStrongPointFast(move.to)) score += 30;
  const killers = context.killers[ply];
  if (killers?.[0] === move.id) score += 50_000;
  else if (killers?.[1] === move.id) score += 25_000;
  score += context.history.get(move.id) ?? 0;
  return score;
}

function recordCutoff(
  move: TurnMove,
  depth: number,
  ply: number,
  context: SearchContext,
): void {
  context.history.set(move.id, (context.history.get(move.id) ?? 0) + depth * depth);
  if (move.isCapture) return;
  const current = context.killers[ply] ?? [null, null];
  if (current[0] !== move.id) context.killers[ply] = [move.id, current[0]];
}

function extractPrincipalVariation(
  start: SearchState,
  depth: number,
  context: SearchContext,
): TurnMove[] {
  const result: TurnMove[] = [];
  let state = start;
  const seen: Array<[number, number]> = [];
  for (let remaining = depth; remaining > 0; remaining -= 1) {
    if (seen.some(([hash, lock]) => hash === state.hash && lock === state.lock)) break;
    seen.push([state.hash, state.lock]);
    const entry = context.tt.get(state.hash);
    if (!entry || entry.lock !== state.lock || !entry.bestMoveId) break;
    const move = generateLegalMovesForBoard(state.board, state.turn).find(
      (candidate) => candidate.id === entry.bestMoveId,
    );
    if (!move) break;
    result.push(move);
    state = applySearchMove(state, move);
  }
  return result;
}

function createSearchState(board: readonly Cell[], turn: Player): SearchState {
  let hash = 0;
  let lock = 0;
  for (let index = 0; index < BOARD_SIZE; index += 1) {
    const piece = board[index];
    if (piece === EMPTY) continue;
    const pieceIndex = piece === SELF ? 0 : 1;
    hash ^= ZOBRIST_HASH[index][pieceIndex];
    lock ^= ZOBRIST_LOCK[index][pieceIndex];
  }
  if (turn === OPPONENT) {
    hash ^= ZOBRIST_SIDE_HASH;
    lock ^= ZOBRIST_SIDE_LOCK;
  }
  return { board: [...board], turn, hash: hash >>> 0, lock: lock >>> 0 };
}

function applySearchMove(state: SearchState, move: TurnMove): SearchState {
  const board = [...state.board];
  let hash = state.hash;
  let lock = state.lock;
  const sideIndex = state.turn === SELF ? 0 : 1;
  const enemyIndex = sideIndex === 0 ? 1 : 0;

  for (const step of move.steps) {
    board[step.from] = EMPTY;
    hash ^= ZOBRIST_HASH[step.from][sideIndex];
    lock ^= ZOBRIST_LOCK[step.from][sideIndex];

    board[step.to] = state.turn;
    hash ^= ZOBRIST_HASH[step.to][sideIndex];
    lock ^= ZOBRIST_LOCK[step.to][sideIndex];

    for (const captured of step.captured) {
      board[captured] = EMPTY;
      hash ^= ZOBRIST_HASH[captured][enemyIndex];
      lock ^= ZOBRIST_LOCK[captured][enemyIndex];
    }
  }

  hash ^= ZOBRIST_SIDE_HASH;
  lock ^= ZOBRIST_SIDE_LOCK;
  return {
    board,
    turn: otherPlayer(state.turn),
    hash: hash >>> 0,
    lock: lock >>> 0,
  };
}

function isRepeatedOnPath(state: SearchState, context: SearchContext): boolean {
  for (let index = 0; index < context.pathHashes.length; index += 1) {
    if (
      context.pathHashes[index] === state.hash &&
      context.pathLocks[index] === state.lock
    ) {
      return true;
    }
  }
  return false;
}

function storeTableEntry(
  state: SearchState,
  entry: TTEntry,
  context: SearchContext,
): void {
  const existing = context.tt.get(state.hash);
  if (existing && existing.lock === state.lock && existing.depth > entry.depth) return;
  if (!existing && context.tt.size >= context.maxTableEntries) return;
  context.tt.set(state.hash, entry);
}

function scoreToTable(score: number, ply: number): number {
  if (score > MATE_THRESHOLD) return score + ply;
  if (score < -MATE_THRESHOLD) return score - ply;
  return score;
}

function scoreFromTable(score: number, ply: number): number {
  if (score > MATE_THRESHOLD) return score - ply;
  if (score < -MATE_THRESHOLD) return score + ply;
  return score;
}

function checkSearchStop(context: SearchContext, force = false): void {
  if (!force && (context.nodes & 127) !== 0) return;
  if (context.shouldStop?.() || nowMs() >= context.deadline) {
    throw new SearchStopped();
  }
}

function isStrongPointFast(index: number): boolean {
  return (Math.floor(index / BOARD_COLS) + (index % BOARD_COLS)) % 2 === 0;
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  const finite = Number.isFinite(value) ? Math.trunc(value) : minimum;
  return Math.min(maximum, Math.max(minimum, finite));
}

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
