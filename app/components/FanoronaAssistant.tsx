"use client";

import {
  ArrowRight,
  BrainCircuit,
  Check,
  RotateCcw,
  Square,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  applyMove,
  applyStep,
  createInitialPosition,
  generateLegalMoves,
  getGameStatus,
  indexToAlgebraic,
  type Cell,
  type Position,
  type Step,
  type TurnMove,
} from "../lib/fanorona";
import { pieceToneFor } from "../lib/presentation";
import { type Locale, t } from "../lib/i18n";
import { AppHeader } from "./AppHeader";
import { type AssistantNavigationProps } from "./assistantTypes";
import { GameOverNotice } from "./GameOverNotice";

type Phase = "opponent" | "thinking" | "recommendation" | "edit" | "gameover";
type Brush = -1 | 0 | 1;

interface HistoryEntry {
  before: Position;
  move: TurnMove;
  side: -1 | 1;
}

interface RankedMove {
  move: TurnMove;
  score: number;
  pv?: TurnMove[];
}

interface SearchSummary {
  topMoves: RankedMove[];
  depth: number;
  nodes: number;
  timeMs: number;
}

interface SearchProgress {
  depth: number;
  nodes: number;
  timeMs: number;
}

interface WorkerProgressMessage extends Partial<SearchProgress> {
  type: "progress";
  id: number;
}

interface WorkerResultMessage {
  type: "result";
  id: number;
  topMoves?: Array<RankedMove | TurnMove>;
  score?: number;
  pv?: TurnMove[];
  depth?: number;
  nodes?: number;
  timeMs?: number;
}

interface WorkerErrorMessage {
  type: "error";
  id: number;
  message?: string;
  error?: string;
}

type WorkerMessage = WorkerProgressMessage | WorkerResultMessage | WorkerErrorMessage;

const STRENGTHS: Record<string, { labelKey: "common.quick" | "common.strong" | "common.revenge"; timeMs: number; maxDepth: number }> = {
  quick: { labelKey: "common.quick", timeMs: 2_000, maxDepth: 8 },
  strong: { labelKey: "common.strong", timeMs: 8_000, maxDepth: 12 },
  revenge: { labelKey: "common.revenge", timeMs: 20_000, maxDepth: 16 },
};

const BOARD_WIDTH = 900;
const BOARD_HEIGHT = 500;
const BOARD_LEFT = 70;
const BOARD_TOP = 60;
const CELL_X = 95;
const CELL_Y = 95;

function pointFor(index: number) {
  const row = Math.floor(index / 9);
  const col = index % 9;
  return { x: BOARD_LEFT + col * CELL_X, y: BOARD_TOP + row * CELL_Y };
}

function buildEdges() {
  const edges: Array<{ from: number; to: number; diagonal: boolean }> = [];
  for (let row = 0; row < 5; row += 1) {
    for (let col = 0; col < 9; col += 1) {
      const from = row * 9 + col;
      if (col < 8) edges.push({ from, to: from + 1, diagonal: false });
      if (row < 4) edges.push({ from, to: from + 9, diagonal: false });
      if ((row + col) % 2 === 0 && row < 4) {
        if (col < 8) edges.push({ from, to: from + 10, diagonal: true });
        if (col > 0) edges.push({ from, to: from + 8, diagonal: true });
      }
    }
  }
  return edges;
}

const BOARD_EDGES = buildEdges();

function stepKey(step: Step) {
  return `${step.from}:${step.to}:${step.capture ?? "move"}:${step.captured.join(",")}`;
}

function sameStep(left: Step, right: Step) {
  return stepKey(left) === stepKey(right);
}

function isPrefix(move: TurnMove, prefix: Step[]) {
  return prefix.every((step, index) => {
    const candidate = move.steps[index];
    return candidate ? sameStep(candidate, step) : false;
  });
}

function uniqueSteps(steps: Step[]) {
  const seen = new Set<string>();
  return steps.filter((step) => {
    const key = stepKey(step);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeRankedMoves(
  moves: Array<RankedMove | TurnMove> | undefined,
  fallbackScore = 0,
  fallbackPv?: TurnMove[],
) {
  if (!moves) return [];
  return moves.map((entry, index) => {
    if ("move" in entry && entry.move && "steps" in entry.move) {
      return entry as RankedMove;
    }
    return {
      move: entry as TurnMove,
      score: index === 0 ? fallbackScore : fallbackScore - index,
      pv: index === 0 ? fallbackPv : undefined,
    };
  });
}

function captureName(locale: Locale, capture: Step["capture"]) {
  if (capture === "approach") return t(locale, "fanorona.approach");
  if (capture === "withdrawal") return t(locale, "fanorona.withdrawal");
  return t(locale, "common.move");
}

function routeNotation(move: TurnMove) {
  if (move.notation) return move.notation;
  if (move.steps.length === 0) return "—";
  return [
    indexToAlgebraic(move.steps[0].from),
    ...move.steps.map((step) => indexToAlgebraic(step.to)),
  ].join(" → ");
}

function totalCaptures(move: TurnMove) {
  return move.steps.reduce((total, step) => total + step.captured.length, 0);
}

function scoreLabel(locale: Locale, score: number) {
  if (score > 900_000) return t(locale, "fanorona.winScore");
  if (score < -900_000) return t(locale, "fanorona.lossScore");
  const value = score / 100;
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
}

function compactNumber(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(value);
}

interface BoardProps {
  board: Cell[];
  locale: Locale;
  firstPlayer: -1 | 1;
  selected: number | null;
  targets: Set<number>;
  route: Step[];
  recommendation: boolean;
  capturePreview: number[];
  interactive: boolean;
  onPoint: (index: number) => void;
}

function FanoronaBoard({
  board,
  locale,
  firstPlayer,
  selected,
  targets,
  route,
  recommendation,
  capturePreview,
  interactive,
  onPoint,
}: BoardProps) {
  const previewSet = useMemo(() => new Set(capturePreview), [capturePreview]);

  return (
    <svg
      className="fanorona-board"
      viewBox={`0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}`}
      role="grid"
      aria-label={t(locale, "fanorona.boardAria")}
    >
      <defs>
        <marker
          id="arrow-input"
          markerWidth="8"
          markerHeight="8"
          refX="6"
          refY="3"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path d="M0,0 L0,6 L7,3 z" fill="var(--amber)" />
        </marker>
        <marker
          id="arrow-recommendation"
          markerWidth="8"
          markerHeight="8"
          refX="6"
          refY="3"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path d="M0,0 L0,6 L7,3 z" fill="var(--teal)" />
        </marker>
      </defs>

      {BOARD_EDGES.map((edge) => {
        const start = pointFor(edge.from);
        const end = pointFor(edge.to);
        return (
          <line
            key={`${edge.from}-${edge.to}`}
            className={`board-edge${edge.diagonal ? " strong" : ""}`}
            x1={start.x}
            y1={start.y}
            x2={end.x}
            y2={end.y}
          />
        );
      })}

      {Array.from({ length: 9 }, (_, col) => (
        <text
          key={`col-${col}`}
          className="board-coordinate"
          x={BOARD_LEFT + col * CELL_X}
          y={484}
          textAnchor="middle"
        >
          {String.fromCharCode(97 + col)}
        </text>
      ))}
      {Array.from({ length: 5 }, (_, row) => (
        <text
          key={`row-${row}`}
          className="board-coordinate"
          x={28}
          y={BOARD_TOP + row * CELL_Y + 6}
          textAnchor="middle"
        >
          {5 - row}
        </text>
      ))}

      {Array.from({ length: 45 }, (_, index) => {
        const point = pointFor(index);
        return (
          <circle
            key={`node-${index}`}
            className="board-node"
            cx={point.x}
            cy={point.y}
            r={5}
          />
        );
      })}

      {route.map((step, index) => {
        const start = pointFor(step.from);
        const end = pointFor(step.to);
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const length = Math.hypot(dx, dy) || 1;
        const trim = 31;
        const x1 = start.x + (dx / length) * trim;
        const y1 = start.y + (dy / length) * trim;
        const x2 = end.x - (dx / length) * trim;
        const y2 = end.y - (dy / length) * trim;
        const midX = (start.x + end.x) / 2 + (-dy / length) * 13;
        const midY = (start.y + end.y) / 2 + (dx / length) * 13;
        return (
          <g key={`route-${index}-${stepKey(step)}`}>
            <line
              className={`route-line${recommendation ? " recommendation" : ""}`}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              markerEnd={`url(#${recommendation ? "arrow-recommendation" : "arrow-input"})`}
            />
            <g
              className={`route-step${recommendation ? " recommendation" : ""}`}
              transform={`translate(${midX} ${midY})`}
            >
              <circle r={13} />
              <text y={5}>{index + 1}</text>
            </g>
          </g>
        );
      })}

      {capturePreview.map((index) => {
        const point = pointFor(index);
        return (
          <g key={`capture-${index}`}>
            <circle className="capture-mark" cx={point.x} cy={point.y} r={31} />
            <line
              className="capture-x"
              x1={point.x - 11}
              y1={point.y - 11}
              x2={point.x + 11}
              y2={point.y + 11}
            />
            <line
              className="capture-x"
              x1={point.x + 11}
              y1={point.y - 11}
              x2={point.x - 11}
              y2={point.y + 11}
            />
          </g>
        );
      })}

      {board.map((piece, index) => {
        if (piece === 0 || previewSet.has(index)) return null;
        const point = pointFor(index);
        const side = piece === -1 ? "opponent" : "self";
        const tone = pieceToneFor(piece, firstPlayer);
        return (
          <g key={`piece-${index}`}>
            <circle
              className={`board-piece ${side} ${tone}`}
              cx={point.x}
              cy={point.y}
              r={25}
            />
            <circle
              className={`piece-center ${tone}`}
              cx={point.x}
              cy={point.y}
              r={7}
            />
          </g>
        );
      })}

      {selected !== null && (() => {
        const point = pointFor(selected);
        return (
          <circle
            className="selection-ring"
            cx={point.x}
            cy={point.y}
            r={34}
          />
        );
      })()}

      {Array.from(targets).map((index) => {
        const point = pointFor(index);
        return (
          <circle
            key={`target-${index}`}
            className="legal-target"
            cx={point.x}
            cy={point.y}
            r={10}
          />
        );
      })}

      {Array.from({ length: 45 }, (_, index) => {
        const point = pointFor(index);
        return (
          <g
            key={`hit-${index}`}
            role="button"
            aria-label={`${indexToAlgebraic(index)}${board[index] === -1 ? t(locale, "fanorona.cellOpponent") : board[index] === 1 ? t(locale, "fanorona.cellSelf") : t(locale, "fanorona.cellEmpty")}`}
            aria-disabled={!interactive}
            tabIndex={interactive ? 0 : -1}
            onClick={() => interactive && onPoint(index)}
            onKeyDown={(event) => {
              if (interactive && (event.key === "Enter" || event.key === " ")) {
                event.preventDefault();
                onPoint(index);
              }
            }}
          >
            <circle
              className={`board-hit${interactive ? "" : " disabled"}`}
              cx={point.x}
              cy={point.y}
              r={38}
            />
          </g>
        );
      })}
    </svg>
  );
}

interface FanoronaAssistantProps extends AssistantNavigationProps {
  createWorker: () => Worker;
}

export function FanoronaAssistant({
  createWorker,
  active,
  game,
  locale,
  installAvailable,
  nativeAndroid,
  onGameChange,
  onInstall,
  onLocaleChange,
}: FanoronaAssistantProps) {
  const [position, setPosition] = useState<Position>(() => createInitialPosition(-1));
  const [firstTurn, setFirstTurn] = useState<-1 | 1>(-1);
  const [phase, setPhase] = useState<Phase>("opponent");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [partialSteps, setPartialSteps] = useState<Step[]>([]);
  const [selectedFrom, setSelectedFrom] = useState<number | null>(null);
  const [pendingChoices, setPendingChoices] = useState<Step[] | null>(null);
  const [capturePreview, setCapturePreview] = useState<number[]>([]);
  const [strength, setStrength] = useState("quick");
  const [searchProgress, setSearchProgress] = useState<SearchProgress>({
    depth: 0,
    nodes: 0,
    timeMs: 0,
  });
  const [searchResult, setSearchResult] = useState<SearchSummary | null>(null);
  const [recommendationIndex, setRecommendationIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [editBoard, setEditBoard] = useState<Cell[]>([]);
  const [editTurn, setEditTurn] = useState<-1 | 1>(-1);
  const [brush, setBrush] = useState<Brush>(-1);
  const [workerEpoch, setWorkerEpoch] = useState(0);
  const workerRef = useRef<Worker | null>(null);
  const searchIdRef = useRef(0);

  const opponentMoves = useMemo(() => {
    if (position.turn !== -1 || phase === "edit") return [];
    return generateLegalMoves(position);
  }, [phase, position]);

  const matchingMoves = useMemo(
    () => opponentMoves.filter((move) => isPrefix(move, partialSteps)),
    [opponentMoves, partialSteps],
  );

  const nextSteps = useMemo(
    () =>
      uniqueSteps(
        matchingMoves
          .filter((move) => move.steps.length > partialSteps.length)
          .map((move) => move.steps[partialSteps.length]),
      ),
    [matchingMoves, partialSteps.length],
  );

  const validFroms = useMemo(
    () => new Set(nextSteps.map((step) => step.from)),
    [nextSteps],
  );

  const targetOptions = useMemo(() => {
    if (selectedFrom === null) return new Map<number, Step[]>();
    const map = new Map<number, Step[]>();
    nextSteps
      .filter((step) => step.from === selectedFrom)
      .forEach((step) => {
        map.set(step.to, [...(map.get(step.to) ?? []), step]);
      });
    return map;
  }, [nextSteps, selectedFrom]);

  const targetIndices = useMemo(() => new Set(targetOptions.keys()), [targetOptions]);

  const canStopOpponent = useMemo(
    () =>
      partialSteps.length > 0 &&
      matchingMoves.some((move) => move.steps.length === partialSteps.length),
    [matchingMoves, partialSteps.length],
  );

  const displayBoard = useMemo(() => {
    if (phase === "edit") return editBoard;
    if (partialSteps.length === 0) return position.board;
    return partialSteps.reduce(
      (board, step) => applyStep(board, step, -1),
      [...position.board],
    );
  }, [editBoard, partialSteps, phase, position.board]);

  const recommended = searchResult?.topMoves[recommendationIndex] ?? null;
  const boardRoute = phase === "recommendation" && recommended
    ? recommended.move.steps
    : partialSteps;
  const recommendedCaptures = useMemo(
    () =>
      phase === "recommendation" && recommended
        ? recommended.move.steps.flatMap((step) => step.captured)
        : capturePreview,
    [capturePreview, phase, recommended],
  );

  const counts = useMemo(
    () => ({
      opponent: displayBoard.filter((piece) => piece === -1).length,
      self: displayBoard.filter((piece) => piece === 1).length,
    }),
    [displayBoard],
  );

  const resetInput = useCallback(() => {
    setPartialSteps([]);
    setSelectedFrom(null);
    setPendingChoices(null);
    setCapturePreview([]);
  }, []);

  const restartWorker = useCallback(() => {
    searchIdRef.current += 1;
    workerRef.current?.terminate();
    workerRef.current = null;
    setWorkerEpoch((value) => value + 1);
  }, []);

  const applyRecordedMove = useCallback(
    (move: TurnMove) => {
      const side = position.turn;
      setHistory((entries) => [...entries, { before: position, move, side }]);
      const next = applyMove(position, move);
      setPosition(next);
      resetInput();
      setSearchResult(null);
      setRecommendationIndex(0);
      setError(null);
      const nextStatus = getGameStatus(next);
      setPhase(nativeAndroid && nextStatus.state === "won" ? "gameover" : next.turn === 1 ? "thinking" : "opponent");
    },
    [nativeAndroid, position, resetInput],
  );

  const acceptOpponentStep = useCallback(
    (step: Step) => {
      const prefix = [...partialSteps, step];
      const candidates = opponentMoves.filter((move) => isPrefix(move, prefix));
      const exact = candidates.find((move) => move.steps.length === prefix.length);
      const hasContinuation = candidates.some((move) => move.steps.length > prefix.length);
      setPendingChoices(null);
      setCapturePreview([]);

      if (exact && !hasContinuation) {
        applyRecordedMove(exact);
        return;
      }

      setPartialSteps(prefix);
      setSelectedFrom(step.to);
    },
    [applyRecordedMove, opponentMoves, partialSteps],
  );

  const handleBoardPoint = useCallback(
    (index: number) => {
      if (phase === "edit") {
        setEditBoard((board) => {
          const next = [...board];
          next[index] = brush;
          return next;
        });
        return;
      }

      if (phase !== "opponent" || position.turn !== -1) return;

      if (selectedFrom !== null) {
        const options = uniqueSteps(targetOptions.get(index) ?? []);
        if (options.length === 1) {
          acceptOpponentStep(options[0]);
          return;
        }
        if (options.length > 1) {
          setPendingChoices(options);
          setCapturePreview([]);
          return;
        }
      }

      if (partialSteps.length === 0 && validFroms.has(index)) {
        setSelectedFrom(index === selectedFrom ? null : index);
        setPendingChoices(null);
        setCapturePreview([]);
      }
    },
    [
      acceptOpponentStep,
      brush,
      partialSteps.length,
      phase,
      position.turn,
      selectedFrom,
      targetOptions,
      validFroms,
    ],
  );

  const finishOpponentTurn = useCallback(() => {
    const exact = matchingMoves.find((move) => move.steps.length === partialSteps.length);
    if (exact) applyRecordedMove(exact);
  }, [applyRecordedMove, matchingMoves, partialSteps.length]);

  const restartOpponentTurn = useCallback(() => {
    resetInput();
    setError(null);
  }, [resetInput]);

  const newGame = useCallback(
    (turn: -1 | 1 = firstTurn) => {
      restartWorker();
      setPosition(createInitialPosition(turn));
      setFirstTurn(turn);
      setHistory([]);
      resetInput();
      setSearchResult(null);
      setRecommendationIndex(0);
      setSearchProgress({ depth: 0, nodes: 0, timeMs: 0 });
      setError(null);
      setPhase(turn === 1 ? "thinking" : "opponent");
    },
    [firstTurn, resetInput, restartWorker],
  );

  const undo = useCallback(() => {
    if (pendingChoices) {
      setPendingChoices(null);
      setCapturePreview([]);
      return;
    }
    if (partialSteps.length > 0) {
      const next = partialSteps.slice(0, -1);
      setPartialSteps(next);
      setSelectedFrom(next.length > 0 ? next[next.length - 1].to : null);
      setCapturePreview([]);
      return;
    }
    const previous = history[history.length - 1];
    if (!previous) return;
    restartWorker();
    setHistory((entries) => entries.slice(0, -1));
    setPosition(previous.before);
    setSearchResult(null);
    setRecommendationIndex(0);
    setError(null);
    setPhase(previous.before.turn === 1 ? "thinking" : "opponent");
  }, [history, partialSteps, pendingChoices, restartWorker]);

  const beginEdit = useCallback(() => {
    restartWorker();
    setEditBoard([...position.board]);
    setEditTurn(position.turn);
    setBrush(-1);
    setSearchResult(null);
    resetInput();
    setPhase("edit");
  }, [position, resetInput, restartWorker]);

  const cancelEdit = useCallback(() => {
    setPhase(position.turn === 1 ? "thinking" : "opponent");
    setError(null);
  }, [position.turn]);

  const confirmEdit = useCallback(() => {
    const opponentCount = editBoard.filter((piece) => piece === -1).length;
    const selfCount = editBoard.filter((piece) => piece === 1).length;
    if (opponentCount === 0 || selfCount === 0) {
      setError(t(locale, "fanorona.needsPieces"));
      return;
    }
    const next = { board: [...editBoard], turn: editTurn };
    setPosition(next);
    setHistory([]);
    setSearchResult(null);
    setRecommendationIndex(0);
    setError(null);
    const nextStatus = getGameStatus(next);
    setPhase(nativeAndroid && nextStatus.state === "won" ? "gameover" : editTurn === 1 ? "thinking" : "opponent");
  }, [editBoard, editTurn, locale, nativeAndroid]);

  useEffect(() => {
    let worker: Worker;
    try {
      worker = createWorker();
    } catch {
      queueMicrotask(() => {
        setError(t(locale, "common.engineBlocked"));
        setPhase("gameover");
      });
      return;
    }
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;
      if (message.id !== searchIdRef.current) return;
      if (message.type === "progress") {
        setSearchProgress({
          depth: message.depth ?? 0,
          nodes: message.nodes ?? 0,
          timeMs: message.timeMs ?? 0,
        });
        return;
      }
      if (message.type === "error") {
        setError(message.message ?? message.error ?? t(locale, "common.engineRetry"));
        setPhase("gameover");
        return;
      }

      const topMoves = normalizeRankedMoves(
        message.topMoves,
        message.score ?? 0,
        message.pv,
      );
      if (topMoves.length === 0) {
        setPhase("gameover");
        setSearchResult({
          topMoves: [],
          depth: message.depth ?? 0,
          nodes: message.nodes ?? 0,
          timeMs: message.timeMs ?? 0,
        });
        return;
      }
      setSearchResult({
        topMoves,
        depth: message.depth ?? 0,
        nodes: message.nodes ?? 0,
        timeMs: message.timeMs ?? 0,
      });
      setRecommendationIndex(0);
      setPhase("recommendation");
    };

    worker.onerror = () => {
      setError(t(locale, "common.engineFailed"));
      setPhase("gameover");
    };

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, [createWorker, locale, workerEpoch]);

  const changeStrength = useCallback(
    (value: string) => {
      if (phase === "thinking") restartWorker();
      setStrength(value);
    },
    [phase, restartWorker],
  );

  useEffect(() => {
    if (active || phase !== "thinking") return;
    const timer = window.setTimeout(restartWorker, 0);
    return () => window.clearTimeout(timer);
  }, [active, phase, restartWorker]);

  useEffect(() => {
    if (!active || position.turn !== 1 || phase === "edit" || phase === "recommendation") return;
    const worker = workerRef.current;
    if (!worker) return;
    const id = searchIdRef.current + 1;
    searchIdRef.current = id;
    const preset = STRENGTHS[strength];
    setPhase("thinking");
    setSearchResult(null);
    setSearchProgress({ depth: 0, nodes: 0, timeMs: 0 });
    setError(null);
    worker.postMessage({
      type: "search",
      id,
      position,
      options: { timeMs: preset.timeMs, maxDepth: preset.maxDepth, topN: 3 },
    });
    return () => worker.postMessage({ type: "cancel", id });
  }, [active, locale, phase, position, strength]);

  const confirmRecommendation = useCallback(() => {
    if (recommended) applyRecordedMove(recommended.move);
  }, [applyRecordedMove, recommended]);

  const turnText = (() => {
    if (phase === "edit") return t(locale, "fanorona.turnEdit");
    if (phase === "thinking") return t(locale, "fanorona.turnThinking");
    if (phase === "recommendation") return t(locale, "fanorona.turnRecommend");
    if (phase === "gameover") return t(locale, "fanorona.turnOver");
    if (partialSteps.length > 0) return t(locale, "fanorona.turnContinue");
    if (selectedFrom !== null) return t(locale, "fanorona.turnTarget");
    return t(locale, "fanorona.turnInput");
  })();

  const noOpponentMove = phase === "opponent" && opponentMoves.length === 0;
  const status = useMemo(() => getGameStatus(position), [position]);
  const latestHistory = history.slice(-12).reverse();
  const canUndo = pendingChoices !== null || partialSteps.length > 0 || history.length > 0;

  return (
    <main className={`app-shell${phase === "recommendation" ? " has-recommendation-confirm" : ""}`}>
      <AppHeader
        game={game}
        locale={locale}
        installAvailable={installAvailable}
        nativeAndroid={nativeAndroid}
        firstTurn={firstTurn}
        onGameChange={onGameChange}
        onInstall={onInstall}
        onToggleFirstTurn={() => newGame(firstTurn === -1 ? 1 : -1)}
        onLocaleChange={onLocaleChange}
        canUndo={canUndo}
        editing={phase === "edit"}
        onUndo={undo}
        onEdit={beginEdit}
        onReset={() => newGame()}
      />

      {active && nativeAndroid && phase === "gameover" && !error && status.state === "won" && status.winner !== null && status.reason !== null && (
        <GameOverNotice
          locale={locale}
          won={status.winner === 1}
          detail={t(locale, status.reason === "elimination"
            ? status.winner === 1 ? "fanorona.endEliminationSelf" : "fanorona.endEliminationOpponent"
            : status.winner === 1 ? "fanorona.endBlockedSelf" : "fanorona.endBlockedOpponent")}
          onRestart={() => newGame()}
        />
      )}

      <div className="workspace">
        <section className="board-column" aria-label={t(locale, "fanorona.boardSection")}>
          <div className="board-toolbar">
            <div className="player-label">
              <span className={`piece-swatch opponent ${pieceToneFor(-1, firstTurn)}`} />
              {t(locale, "common.opponent")}
              <span className="count-pill">{counts.opponent}</span>
            </div>
            <div
              className={`turn-indicator${
                phase === "thinking"
                  ? " thinking"
                  : phase === "opponent"
                    ? " opponent-turn"
                    : ""
              }`}
              title={turnText}
            >
              {turnText}
            </div>
            <div className="player-label">
              <span className="count-pill">{counts.self}</span>
              {t(locale, "common.self")}
              <span className={`piece-swatch self ${pieceToneFor(1, firstTurn)}`} />
            </div>
          </div>

          <div className="board-frame">
            <FanoronaBoard
              board={displayBoard}
              locale={locale}
              firstPlayer={firstTurn}
              selected={phase === "edit" ? null : selectedFrom}
              targets={phase === "edit" ? new Set<number>() : targetIndices}
              route={boardRoute}
              recommendation={phase === "recommendation"}
              capturePreview={recommendedCaptures}
              interactive={phase === "opponent" || phase === "edit"}
              onPoint={handleBoardPoint}
            />
          </div>

          <div className="board-footer">
            <span className="board-note">{t(locale, "fanorona.coordinateNote")}</span>
            <div className="legend" aria-label={t(locale, "fanorona.markerLegend")}>
              <span><i className="legend-dot" />{t(locale, "fanorona.legalTarget")}</span>
              <span><i className="legend-dot route" />{t(locale, "fanorona.selfRoute")}</span>
            </div>
          </div>
        </section>

        <aside className="analysis-panel" aria-label={t(locale, "fanorona.console")}>
          <section className="panel-section" aria-live="polite">
            {phase === "opponent" && (
              <>
                <div className="panel-heading-row">
                  <div>
                    <p className="eyebrow">{t(locale, "common.opponentTurn")}</p>
                    <h2 className="panel-title">
                      {pendingChoices
                        ? t(locale, "fanorona.chooseCapture")
                        : partialSteps.length > 0
                          ? t(locale, "fanorona.recordChain")
                          : selectedFrom !== null
                            ? t(locale, "fanorona.chooseTarget")
                            : t(locale, "fanorona.choosePiece")}
                    </h2>
                  </div>
                  <span className="mode-badge opponent">{t(locale, "common.input")}</span>
                </div>

                {noOpponentMove ? (
                  <div className="warning-box">{t(locale, "fanorona.opponentNoMove")}</div>
                ) : pendingChoices ? (
                  <div className="capture-choice">
                    {pendingChoices.map((step) => (
                      <button
                        key={stepKey(step)}
                        type="button"
                        className="choice-button"
                        onMouseEnter={() => setCapturePreview(step.captured)}
                        onMouseLeave={() => setCapturePreview([])}
                        onFocus={() => setCapturePreview(step.captured)}
                        onBlur={() => setCapturePreview([])}
                        onClick={() => acceptOpponentStep(step)}
                      >
                        <span className="choice-main">
                          <span className="choice-icon"><ArrowRight size={16} /></span>
                          <span className="choice-copy">
                            <strong>{captureName(locale, step.capture)}</strong>
                            <span>{indexToAlgebraic(step.from)} → {indexToAlgebraic(step.to)}</span>
                          </span>
                        </span>
                        <span className="choice-count">{t(locale, "fanorona.capturePieces", { count: step.captured.length })}</span>
                      </button>
                    ))}
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => {
                        setPendingChoices(null);
                        setCapturePreview([]);
                      }}
                    >
                      <X size={16} /> {t(locale, "common.cancel")}
                    </button>
                  </div>
                ) : (
                  <>
                    <p className="panel-subtitle">
                      {partialSteps.length > 0
                        ? t(locale, "fanorona.startRecorded", { point: indexToAlgebraic(partialSteps[0].from), count: partialSteps.length })
                        : selectedFrom !== null
                          ? t(locale, "fanorona.selected", { point: indexToAlgebraic(selectedFrom) })
                          : ""}
                    </p>
                    {partialSteps.length > 0 && (
                      <div className="route-card">
                        <div className="route-main">
                          {[
                            indexToAlgebraic(partialSteps[0].from),
                            ...partialSteps.map((step) => indexToAlgebraic(step.to)),
                          ].join(" → ")}
                        </div>
                      </div>
                    )}
                    <div className="action-stack">
                      {canStopOpponent && (
                        <button
                          type="button"
                          className="primary-button"
                          onClick={finishOpponentTurn}
                        >
                          <Square size={15} fill="currentColor" /> {t(locale, "fanorona.stopOpponent")}
                        </button>
                      )}
                      {partialSteps.length > 0 && (
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={restartOpponentTurn}
                        >
                          <RotateCcw size={16} /> {t(locale, "fanorona.reenterTurn")}
                        </button>
                      )}
                    </div>
                  </>
                )}
              </>
            )}

            {phase === "thinking" && (
              <>
                <div className="panel-heading-row">
                  <div>
                    <p className="eyebrow">{t(locale, "common.selfTurn")}</p>
                    <h2 className="panel-title">{t(locale, "fanorona.calculate")}</h2>
                  </div>
                  <span className="mode-badge thinking">{t(locale, "common.thinking")}</span>
                </div>
                <div className="thinking-box">
                  <div className="spinner" aria-hidden="true" />
                  <div className="thinking-depth">
                    {searchProgress.depth > 0
                      ? t(locale, "common.searchDepth", { depth: searchProgress.depth })
                      : t(locale, "common.expanding")}
                  </div>
                  <div className="thinking-nodes">
                    {t(locale, "common.positionCount", { count: compactNumber(searchProgress.nodes) })}
                  </div>
                </div>
              </>
            )}

            {phase === "recommendation" && recommended && searchResult && (
              <>
                <div className="panel-heading-row">
                  <div>
                    <p className="eyebrow">{t(locale, "common.selfTurn")}</p>
                    <h2 className="panel-title">{t(locale, "fanorona.followLine")}</h2>
                  </div>
                  <span className="mode-badge">{t(locale, "common.recommendation")}</span>
                </div>

                {searchResult.topMoves.length > 1 && (
                  <label className="field-label" style={{ marginTop: 14 }}>
                    {t(locale, "common.candidateMoves")}
                    <select
                      className="select-control"
                      value={recommendationIndex}
                      onChange={(event) => setRecommendationIndex(Number(event.target.value))}
                    >
                      {searchResult.topMoves.map((entry, index) => (
                        <option key={`${routeNotation(entry.move)}-${index}`} value={index}>
                          {index === 0
                            ? t(locale, "common.primary")
                            : t(locale, "common.alternative", { index })} · {routeNotation(entry.move)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                <div className="route-card">
                  <div className="route-main">{routeNotation(recommended.move)}</div>
                  <ol className="route-details">
                    {recommended.move.steps.map((step, index) => (
                      <li key={stepKey(step)} className="route-detail">
                        <span className="route-number">{index + 1}</span>
                        <span>{indexToAlgebraic(step.from)} → {indexToAlgebraic(step.to)}</span>
                        <span className="capture-label">
                          {step.capture
                            ? `${captureName(locale, step.capture)} ${step.captured.length}`
                            : t(locale, "common.move")}
                        </span>
                      </li>
                    ))}
                  </ol>
                  <div className="analysis-stats">
                    <div className="stat">
                      <span className="stat-label">{t(locale, "common.score")}</span>
                      <span className="stat-value">{scoreLabel(locale, recommended.score)}</span>
                    </div>
                    <div className="stat">
                      <span className="stat-label">{t(locale, "common.search")}</span>
                      <span className="stat-value">{t(locale, "common.depth", { depth: searchResult.depth })}</span>
                    </div>
                    <div className="stat">
                      <span className="stat-label">{t(locale, "common.positions")}</span>
                      <span className="stat-value">{compactNumber(searchResult.nodes)}</span>
                    </div>
                  </div>
                </div>

                <div className="action-stack recommendation-confirm">
                  <button
                    type="button"
                    className="primary-button"
                    onClick={confirmRecommendation}
                  >
                    <Check size={18} /> {t(locale, "common.doneInGame")}
                  </button>
                </div>
              </>
            )}

            {phase === "edit" && (
              <>
                <div className="panel-heading-row">
                  <div>
                    <p className="eyebrow">{t(locale, "common.calibrate")}</p>
                    <h2 className="panel-title">{t(locale, "common.matchGame")}</h2>
                  </div>
                  <span className="mode-badge thinking">{t(locale, "common.editing")}</span>
                </div>
                <div className="edit-toolbar" aria-label={t(locale, "fanorona.editPieces")}>
                  <button
                    type="button"
                    className={`brush-button${brush === -1 ? " active" : ""}`}
                    onClick={() => setBrush(-1)}
                  >
                    <span className={`piece-swatch opponent ${pieceToneFor(-1, firstTurn)}`} /> {t(locale, "common.opponent")}
                  </button>
                  <button
                    type="button"
                    className={`brush-button${brush === 0 ? " active" : ""}`}
                    onClick={() => setBrush(0)}
                  >
                    <span className="brush-empty" /> {t(locale, "common.empty")}
                  </button>
                  <button
                    type="button"
                    className={`brush-button${brush === 1 ? " active" : ""}`}
                    onClick={() => setBrush(1)}
                  >
                    <span className={`piece-swatch self ${pieceToneFor(1, firstTurn)}`} /> {t(locale, "common.self")}
                  </button>
                </div>
                <label className="field-label" style={{ marginTop: 14 }}>
                  {t(locale, "common.nextTurn")}
                  <div className="segmented">
                    <button
                      type="button"
                      className={`segment${editTurn === -1 ? " active" : ""}`}
                      aria-pressed={editTurn === -1}
                      onClick={() => setEditTurn(-1)}
                    >
                      {t(locale, "common.opponent")}
                    </button>
                    <button
                      type="button"
                      className={`segment${editTurn === 1 ? " active" : ""}`}
                      aria-pressed={editTurn === 1}
                      onClick={() => setEditTurn(1)}
                    >
                      {t(locale, "common.self")}
                    </button>
                  </div>
                </label>
                <div className="inline-actions">
                  <button type="button" className="secondary-button" onClick={cancelEdit}>
                    <X size={16} /> {t(locale, "common.cancel")}
                  </button>
                  <button type="button" className="primary-button" onClick={confirmEdit}>
                    <Check size={17} /> {t(locale, "common.apply")}
                  </button>
                </div>
              </>
            )}

            {phase === "gameover" && (
              <>
                <div className="panel-heading-row">
                  <div>
                    <p className="eyebrow">{t(locale, "common.gameOver")}</p>
                    <h2 className="panel-title">
                      {error
                        ? t(locale, "common.engineError")
                        : counts.opponent === 0 || noOpponentMove
                        ? t(locale, "common.win")
                        : t(locale, "common.noLegalMove")}
                    </h2>
                  </div>
                  <span className="mode-badge">{t(locale, "common.finished")}</span>
                </div>
                <div className="action-stack">
                  <button type="button" className="primary-button" onClick={() => newGame()}>
                    <RotateCcw size={17} /> {t(locale, "common.playAgain")}
                  </button>
                </div>
              </>
            )}

            {error && <div className="error-box">{error}</div>}
          </section>

          <section className="panel-section">
            <div className="panel-heading-row">
              <div>
                <p className="eyebrow">{t(locale, "common.settingsEyebrow")}</p>
                <h2 className="panel-title">{t(locale, "common.settings")}</h2>
              </div>
              <BrainCircuit size={19} aria-hidden="true" />
            </div>
            <div className={`settings-grid${nativeAndroid ? " single-setting" : ""}`} style={{ marginTop: 14 }}>
              <label className="field-label">
                {t(locale, "common.strength")}
                <select
                  className="select-control"
                  value={strength}
                  onChange={(event) => changeStrength(event.target.value)}
                >
                  {Object.entries(STRENGTHS).map(([value, preset]) => (
                    <option key={value} value={value}>{t(locale, preset.labelKey)}</option>
                  ))}
                </select>
              </label>
              {!nativeAndroid && <div className="field-label">
                {t(locale, "common.firstTurn")}
                <div className="segmented">
                  <button
                    type="button"
                    className={`segment${firstTurn === -1 ? " active" : ""}`}
                    aria-pressed={firstTurn === -1}
                    onClick={() => newGame(-1)}
                  >
                    {t(locale, "common.opponentFirst")}
                  </button>
                  <button
                    type="button"
                    className={`segment${firstTurn === 1 ? " active" : ""}`}
                    aria-pressed={firstTurn === 1}
                    onClick={() => newGame(1)}
                  >
                    {t(locale, "common.selfFirst")}
                  </button>
                </div>
              </div>}
            </div>
          </section>

          <section className="panel-section">
            <div className="panel-heading-row">
              <div>
                <p className="eyebrow">{t(locale, "common.recentTurns")}</p>
                <h2 className="panel-title">{t(locale, "common.history")}</h2>
              </div>
              <span className="count-pill">{history.length}</span>
            </div>
            {latestHistory.length === 0 ? (
              <div className="history-empty">{t(locale, "common.noHistory")}</div>
            ) : (
              <ol className="history-list">
                {latestHistory.map((entry, index) => (
                  <li
                    key={`${history.length - index}-${routeNotation(entry.move)}`}
                    className="history-row"
                    title={routeNotation(entry.move)}
                  >
                    <span className="history-index">{history.length - index}.</span>
                    <span className={`history-side ${entry.side === -1 ? "opponent" : "self"}`}>
                      {entry.side === -1 ? t(locale, "common.opponent") : t(locale, "common.self")}
                    </span>
                    <span className="history-notation">{routeNotation(entry.move)}</span>
                    <span className="history-captures">
                      {totalCaptures(entry.move) > 0
                        ? t(locale, "common.captured", { count: totalCaptures(entry.move) })
                        : "—"}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </aside>
      </div>
    </main>
  );
}
