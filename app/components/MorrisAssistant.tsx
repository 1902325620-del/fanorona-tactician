"use client";

import { BrainCircuit, Check, Crown, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ADJACENCY,
  EMPTY,
  MORRIS_POINTS,
  OPPONENT,
  SELF,
  applyMove,
  createInitialPosition,
  generateLegalMoves,
  getGameStatus,
  getPhase,
  indexToAlgebraic,
  type MorrisCell,
  type MorrisMove,
  type MorrisPosition,
  type Player,
  type SearchLine,
} from "../lib/morris";
import { t } from "../lib/i18n";
import { pieceToneFor } from "../lib/presentation";
import { AppHeader } from "./AppHeader";
import { type AssistantNavigationProps } from "./assistantTypes";
import { GameOverNotice } from "./GameOverNotice";

type UiPhase = "opponent" | "thinking" | "recommendation" | "edit" | "gameover";
type Brush = MorrisCell;

interface HistoryEntry {
  before: MorrisPosition;
  move: MorrisMove;
  side: Player;
}

interface SearchState {
  topMoves: readonly SearchLine[];
  depth: number;
  nodes: number;
  timeMs: number;
}

interface WorkerMessage {
  type: "progress" | "result" | "error" | "cancelled";
  id: number;
  topMoves?: readonly SearchLine[];
  depth?: number;
  nodes?: number;
  timeMs?: number;
  message?: string;
}

interface MorrisAssistantProps extends AssistantNavigationProps {
  createWorker: () => Worker;
}

const STRENGTHS = {
  quick: { labelKey: "common.quick" as const, timeMs: 2_000, maxDepth: 5 },
  strong: { labelKey: "common.strong" as const, timeMs: 8_000, maxDepth: 7 },
  revenge: { labelKey: "common.revenge" as const, timeMs: 20_000, maxDepth: 9 },
};

const MORRIS_EDGES = ADJACENCY.flatMap((targets, from) =>
  targets.filter((to) => from < to).map((to) => ({ from, to })),
);

function pointPosition(index: number) {
  const point = MORRIS_POINTS[index];
  return { x: 60 + point.col * 80, y: 60 + point.row * 80 };
}

function compactNumber(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(value);
}

function scoreLabel(score: number) {
  const normalized = score / 100;
  return `${normalized >= 0 ? "+" : ""}${normalized.toFixed(1)}`;
}

function phaseLabel(locale: AssistantNavigationProps["locale"], phase: "placing" | "moving" | "flying") {
  if (phase === "placing") return t(locale, "morris.place");
  if (phase === "flying") return t(locale, "morris.fly");
  return t(locale, "morris.slide");
}

function moveKindLabel(locale: AssistantNavigationProps["locale"], kind: MorrisMove["kind"]) {
  if (kind === "place") return t(locale, "morris.place");
  if (kind === "fly") return t(locale, "morris.fly");
  return t(locale, "morris.slide");
}

interface MorrisBoardProps {
  board: readonly MorrisCell[];
  firstPlayer: Player;
  selected: number | null;
  targets: ReadonlySet<number>;
  recommendation: MorrisMove | null;
  pendingRemoval: boolean;
  interactive: boolean;
  locale: AssistantNavigationProps["locale"];
  onPoint: (index: number) => void;
}

function MorrisBoard({
  board,
  firstPlayer,
  selected,
  targets,
  recommendation,
  pendingRemoval,
  interactive,
  locale,
  onPoint,
}: MorrisBoardProps) {
  const recommendedFrom = recommendation?.from ?? null;
  const recommendedTo = recommendation?.to ?? null;
  const recommendedRemove = recommendation?.remove ?? null;

  return (
    <svg
      className="morris-board"
      viewBox="0 0 600 600"
      role="grid"
      aria-label={t(locale, "morris.boardAria")}
    >
      <defs>
        <marker id="morris-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L0,6 L7,3 z" fill="var(--teal)" />
        </marker>
      </defs>
      {MORRIS_EDGES.map((edge) => {
        const from = pointPosition(edge.from);
        const to = pointPosition(edge.to);
        return (
          <line
            key={`${edge.from}-${edge.to}`}
            className="morris-edge"
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
          />
        );
      })}

      {recommendedFrom !== null && recommendedTo !== null && (() => {
        const from = pointPosition(recommendedFrom);
        const to = pointPosition(recommendedTo);
        return (
          <line
            className="recommendation-line"
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            markerEnd="url(#morris-arrow)"
          />
        );
      })()}

      {MORRIS_POINTS.map((point) => {
        const { x, y } = pointPosition(point.index);
        const piece = board[point.index];
        const isTarget = targets.has(point.index);
        const isRecommended = recommendedTo === point.index;
        const isRemoved = recommendedRemove === point.index;
        return (
          <g
            key={point.label}
            role="gridcell"
            tabIndex={interactive ? 0 : -1}
            aria-label={`${point.label}${piece === OPPONENT ? ` ${t(locale, "common.opponent")}` : piece === SELF ? ` ${t(locale, "common.self")}` : ` ${t(locale, "common.empty")}`}`}
            className={`morris-point${interactive ? " interactive" : ""}`}
            onClick={() => interactive && onPoint(point.index)}
            onKeyDown={(event) => {
              if (interactive && (event.key === "Enter" || event.key === " ")) {
                event.preventDefault();
                onPoint(point.index);
              }
            }}
          >
            <circle className="morris-node" cx={x} cy={y} r={6} />
            {(isTarget || isRecommended) && (
              <circle
                className={`board-target${isRecommended ? " recommended" : ""}`}
                cx={x}
                cy={y}
                r={24}
              />
            )}
            {piece !== EMPTY && (
              <circle
                className={`board-piece ${piece === OPPONENT ? "opponent" : "self"} ${pieceToneFor(piece, firstPlayer)}${selected === point.index ? " selected" : ""}${pendingRemoval && isTarget ? " removable" : ""}`}
                cx={x}
                cy={y}
                r={20}
              />
            )}
            {isRemoved && (
              <g className="remove-mark">
                <line x1={x - 12} y1={y - 12} x2={x + 12} y2={y + 12} />
                <line x1={x + 12} y1={y - 12} x2={x - 12} y2={y + 12} />
              </g>
            )}
            <circle className="board-hit" cx={x} cy={y} r={30} />
          </g>
        );
      })}
    </svg>
  );
}

export function MorrisAssistant({
  createWorker,
  active,
  game,
  locale,
  installAvailable,
  nativeAndroid,
  onGameChange,
  onInstall,
  onLocaleChange,
}: MorrisAssistantProps) {
  const [position, setPosition] = useState<MorrisPosition>(() => createInitialPosition(OPPONENT));
  const [firstTurn, setFirstTurn] = useState<Player>(OPPONENT);
  const [phase, setPhase] = useState<UiPhase>("opponent");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [selectedFrom, setSelectedFrom] = useState<number | null>(null);
  const [pendingRemovalMoves, setPendingRemovalMoves] = useState<readonly MorrisMove[] | null>(null);
  const [strength, setStrength] = useState<keyof typeof STRENGTHS>("quick");
  const [searchProgress, setSearchProgress] = useState({ depth: 0, nodes: 0, timeMs: 0 });
  const [searchResult, setSearchResult] = useState<SearchState | null>(null);
  const [recommendationIndex, setRecommendationIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [workerEpoch, setWorkerEpoch] = useState(0);
  const [editBoard, setEditBoard] = useState<MorrisCell[]>([]);
  const [editTurn, setEditTurn] = useState<Player>(OPPONENT);
  const [editSelfToPlace, setEditSelfToPlace] = useState(9);
  const [editOpponentToPlace, setEditOpponentToPlace] = useState(9);
  const [brush, setBrush] = useState<Brush>(OPPONENT);
  const workerRef = useRef<Worker | null>(null);
  const searchIdRef = useRef(0);

  const legalMoves = useMemo(() => generateLegalMoves(position), [position]);
  const opponentMoves = useMemo(
    () => position.turn === OPPONENT && phase !== "edit" ? legalMoves : [],
    [legalMoves, phase, position.turn],
  );
  const validFroms = useMemo(
    () => new Set(opponentMoves.flatMap((move) => move.from === null ? [] : [move.from])),
    [opponentMoves],
  );
  const targetMoves = useMemo(() => {
    if (pendingRemovalMoves) return new Map<number, readonly MorrisMove[]>();
    const relevant = opponentMoves.filter((move) =>
      move.from === null ? selectedFrom === null : move.from === selectedFrom,
    );
    const map = new Map<number, MorrisMove[]>();
    for (const move of relevant) map.set(move.to, [...(map.get(move.to) ?? []), move]);
    return map;
  }, [opponentMoves, pendingRemovalMoves, selectedFrom]);
  const targetIndices = useMemo(() => {
    if (pendingRemovalMoves) {
      return new Set(pendingRemovalMoves.flatMap((move) => move.remove === null ? [] : [move.remove]));
    }
    return new Set(targetMoves.keys());
  }, [pendingRemovalMoves, targetMoves]);
  const recommended = searchResult?.topMoves[recommendationIndex] ?? null;
  const displayBoard = phase === "edit" ? editBoard : position.board;
  const counts = useMemo(() => ({
    opponent: displayBoard.filter((cell) => cell === OPPONENT).length,
    self: displayBoard.filter((cell) => cell === SELF).length,
  }), [displayBoard]);
  const status = useMemo(() => getGameStatus(position), [position]);
  const canUndo = pendingRemovalMoves !== null || selectedFrom !== null || history.length > 0;

  const restartWorker = useCallback(() => {
    searchIdRef.current += 1;
    workerRef.current?.terminate();
    workerRef.current = null;
    setWorkerEpoch((value) => value + 1);
  }, []);

  const resetInput = useCallback(() => {
    setSelectedFrom(null);
    setPendingRemovalMoves(null);
  }, []);

  const applyRecordedMove = useCallback((move: MorrisMove) => {
    const side = position.turn;
    const next = applyMove(position, move);
    setHistory((entries) => [...entries, { before: position, move, side }]);
    setPosition(next);
    resetInput();
    setSearchResult(null);
    setRecommendationIndex(0);
    setError(null);
    const nextStatus = getGameStatus(next);
    setPhase(nextStatus.state === "won" ? "gameover" : next.turn === SELF ? "thinking" : "opponent");
  }, [position, resetInput]);

  const handleBoardPoint = useCallback((index: number) => {
    if (phase === "edit") {
      setEditBoard((board) => {
        const next = [...board];
        next[index] = brush;
        return next;
      });
      return;
    }
    if (phase !== "opponent" || position.turn !== OPPONENT) return;

    if (pendingRemovalMoves) {
      const move = pendingRemovalMoves.find((candidate) => candidate.remove === index);
      if (move) applyRecordedMove(move);
      return;
    }

    const candidates = targetMoves.get(index) ?? [];
    if (candidates.length === 1) {
      applyRecordedMove(candidates[0]);
      return;
    }
    if (candidates.length > 1) {
      setPendingRemovalMoves(candidates);
      return;
    }

    if (validFroms.has(index)) {
      setSelectedFrom(selectedFrom === index ? null : index);
    }
  }, [applyRecordedMove, brush, pendingRemovalMoves, phase, position.turn, selectedFrom, targetMoves, validFroms]);

  const newGame = useCallback((turn: Player = firstTurn) => {
    restartWorker();
    setPosition(createInitialPosition(turn));
    setFirstTurn(turn);
    setHistory([]);
    resetInput();
    setSearchProgress({ depth: 0, nodes: 0, timeMs: 0 });
    setSearchResult(null);
    setError(null);
    setPhase(turn === SELF ? "thinking" : "opponent");
  }, [firstTurn, resetInput, restartWorker]);

  const undo = useCallback(() => {
    if (pendingRemovalMoves || selectedFrom !== null) {
      resetInput();
      return;
    }
    const previous = history.at(-1);
    if (!previous) return;
    restartWorker();
    setHistory((entries) => entries.slice(0, -1));
    setPosition(previous.before);
    setSearchResult(null);
    setError(null);
    setPhase(previous.before.turn === SELF ? "thinking" : "opponent");
  }, [history, pendingRemovalMoves, resetInput, restartWorker, selectedFrom]);

  const beginEdit = useCallback(() => {
    restartWorker();
    setEditBoard([...position.board]);
    setEditTurn(position.turn);
    setEditSelfToPlace(position.selfToPlace);
    setEditOpponentToPlace(position.opponentToPlace);
    setBrush(OPPONENT);
    resetInput();
    setPhase("edit");
  }, [position, resetInput, restartWorker]);

  const cancelEdit = useCallback(() => {
    setError(null);
    setPhase(position.turn === SELF ? "thinking" : "opponent");
  }, [position.turn]);

  const confirmEdit = useCallback(() => {
    const selfCount = editBoard.filter((cell) => cell === SELF).length;
    const opponentCount = editBoard.filter((cell) => cell === OPPONENT).length;
    if (selfCount + editSelfToPlace > 9 || opponentCount + editOpponentToPlace > 9) {
      setError(t(locale, "morris.invalidPosition"));
      return;
    }
    const next: MorrisPosition = {
      board: [...editBoard],
      turn: editTurn,
      selfToPlace: editSelfToPlace,
      opponentToPlace: editOpponentToPlace,
      ply: 0,
    };
    setPosition(next);
    setHistory([]);
    setError(null);
    setSearchResult(null);
    const nextStatus = getGameStatus(next);
    setPhase(nextStatus.state === "won" ? "gameover" : editTurn === SELF ? "thinking" : "opponent");
  }, [editBoard, editOpponentToPlace, editSelfToPlace, editTurn, locale]);

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
        setError(message.message ?? t(locale, "common.engineRetry"));
        setPhase("gameover");
        return;
      }
      if (message.type !== "result") return;
      const topMoves = message.topMoves ?? [];
      setSearchResult({
        topMoves,
        depth: message.depth ?? 0,
        nodes: message.nodes ?? 0,
        timeMs: message.timeMs ?? 0,
      });
      setRecommendationIndex(0);
      setPhase(topMoves.length > 0 ? "recommendation" : "gameover");
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

  useEffect(() => {
    if (active || phase !== "thinking") return;
    const timer = window.setTimeout(restartWorker, 0);
    return () => window.clearTimeout(timer);
  }, [active, phase, restartWorker]);

  useEffect(() => {
    if (!active || position.turn !== SELF || phase === "edit" || phase === "recommendation") return;
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

  const turnText = pendingRemovalMoves
    ? t(locale, "morris.chooseRemovalShort")
    : phase === "edit"
      ? t(locale, "morris.turnEdit")
      : phase === "thinking"
        ? t(locale, "morris.turnThinking")
        : phase === "recommendation"
          ? t(locale, "morris.turnRecommend")
          : phase === "gameover"
            ? t(locale, "morris.turnOver")
            : t(locale, "morris.inputMove");
  const currentPhase = getPhase(position, position.turn);
  const latestHistory = history.slice(-12).reverse();

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
        onToggleFirstTurn={() => newGame(firstTurn === OPPONENT ? SELF : OPPONENT)}
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
          won={status.winner === SELF}
          detail={t(locale, status.reason === "fewer-than-three"
            ? status.winner === SELF ? "morris.endFewerSelf" : "morris.endFewerOpponent"
            : status.winner === SELF ? "morris.endBlockedSelf" : "morris.endBlockedOpponent")}
          onRestart={() => newGame()}
        />
      )}

      <div className="workspace abstract-workspace">
        <section className="board-column" aria-label={t(locale, "morris.boardSection")}>
          <div className="board-toolbar">
            <div className="player-label">
              <span className={`piece-swatch opponent ${pieceToneFor(OPPONENT, firstTurn)}`} />
              {t(locale, "common.opponent")}
              <span className="count-pill">{counts.opponent}</span>
              <span className="reserve-count">+{position.opponentToPlace}</span>
            </div>
            <div className={`turn-indicator${phase === "thinking" ? " thinking" : phase === "opponent" ? " opponent-turn" : ""}`} title={turnText}>
              {turnText}
            </div>
            <div className="player-label">
              <span className="reserve-count">+{position.selfToPlace}</span>
              <span className="count-pill">{counts.self}</span>
              {t(locale, "common.self")}
              <span className={`piece-swatch self ${pieceToneFor(SELF, firstTurn)}`} />
            </div>
          </div>

          <div className="board-frame abstract-frame">
            <MorrisBoard
              board={displayBoard}
              firstPlayer={firstTurn}
              selected={phase === "edit" ? null : selectedFrom}
              targets={phase === "edit" ? new Set<number>() : targetIndices}
              recommendation={phase === "recommendation" ? recommended?.move ?? null : null}
              pendingRemoval={pendingRemovalMoves !== null}
              interactive={phase === "opponent" || phase === "edit"}
              locale={locale}
              onPoint={handleBoardPoint}
            />
          </div>
          <div className="board-footer">
            <span className="board-note">{t(locale, "morris.coordinateNote")}</span>
            <div className="legend">
              <span><i className="legend-dot" />{t(locale, "morris.legalTarget")}</span>
              <span><i className="legend-dot route" />{t(locale, "morris.recommended")}</span>
            </div>
          </div>
        </section>

        <aside className="analysis-panel" aria-label={t(locale, "morris.console")}>
          <section className="panel-section" aria-live="polite">
            {phase === "opponent" && (
              <>
                <div className="panel-heading-row">
                  <div>
                    <p className="eyebrow">{t(locale, "common.opponentTurn")}</p>
                    <h2 className="panel-title">
                      {pendingRemovalMoves
                        ? t(locale, "morris.chooseRemoval")
                        : selectedFrom !== null
                          ? t(locale, "morris.chooseTarget")
                          : currentPhase === "placing"
                            ? t(locale, "morris.place")
                            : t(locale, "morris.choosePiece")}
                    </h2>
                  </div>
                  <span className="mode-badge opponent">{t(locale, "common.input")}</span>
                </div>
                {selectedFrom !== null && (
                  <p className="panel-subtitle">{indexToAlgebraic(selectedFrom)}</p>
                )}
                {(pendingRemovalMoves || selectedFrom !== null) && (
                  <button type="button" className="secondary-button" onClick={resetInput}>
                    <X size={16} /> {t(locale, "common.cancel")}
                  </button>
                )}
              </>
            )}

            {phase === "thinking" && (
              <>
                <div className="panel-heading-row">
                  <div>
                    <p className="eyebrow">{t(locale, "common.selfTurn")}</p>
                    <h2 className="panel-title">{t(locale, "morris.calculate")}</h2>
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
                    <h2 className="panel-title">{t(locale, "morris.follow")}</h2>
                  </div>
                  <span className="mode-badge">{t(locale, "common.recommendation")}</span>
                </div>
                {searchResult.topMoves.length > 1 && (
                  <label className="field-label" style={{ marginTop: 14 }}>
                    {t(locale, "common.candidateMoves")}
                    <select className="select-control" value={recommendationIndex} onChange={(event) => setRecommendationIndex(Number(event.target.value))}>
                      {searchResult.topMoves.map((line, index) => (
                        <option key={`${line.move.id}-${index}`} value={index}>
                          {index === 0 ? t(locale, "common.primary") : t(locale, "common.alternative", { index })} · {line.move.notation}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <div className="route-card">
                  <div className="route-main">{recommended.move.notation}</div>
                  <div className="route-summary">
                    {moveKindLabel(locale, recommended.move.kind)}
                    {recommended.move.remove !== null && ` · ${t(locale, "morris.remove")} ${indexToAlgebraic(recommended.move.remove)}`}
                  </div>
                  <div className="analysis-stats">
                    <div className="stat"><span className="stat-label">{t(locale, "common.score")}</span><span className="stat-value">{scoreLabel(recommended.score)}</span></div>
                    <div className="stat"><span className="stat-label">{t(locale, "common.search")}</span><span className="stat-value">{t(locale, "common.depth", { depth: searchResult.depth })}</span></div>
                    <div className="stat"><span className="stat-label">{t(locale, "common.positions")}</span><span className="stat-value">{compactNumber(searchResult.nodes)}</span></div>
                  </div>
                </div>
                <div className="action-stack recommendation-confirm">
                  <button type="button" className="primary-button" onClick={() => applyRecordedMove(recommended.move)}>
                    <Check size={18} /> {t(locale, "common.doneInGame")}
                  </button>
                </div>
              </>
            )}

            {phase === "edit" && (
              <>
                <div className="panel-heading-row">
                  <div><p className="eyebrow">{t(locale, "common.calibrate")}</p><h2 className="panel-title">{t(locale, "common.matchGame")}</h2></div>
                  <span className="mode-badge thinking">{t(locale, "common.editing")}</span>
                </div>
                <div className="edit-toolbar">
                  <button type="button" className={`brush-button${brush === OPPONENT ? " active" : ""}`} onClick={() => setBrush(OPPONENT)}><span className={`piece-swatch opponent ${pieceToneFor(OPPONENT, firstTurn)}`} />{t(locale, "common.opponent")}</button>
                  <button type="button" className={`brush-button${brush === EMPTY ? " active" : ""}`} onClick={() => setBrush(EMPTY)}><span className="brush-empty" />{t(locale, "common.empty")}</button>
                  <button type="button" className={`brush-button${brush === SELF ? " active" : ""}`} onClick={() => setBrush(SELF)}><span className={`piece-swatch self ${pieceToneFor(SELF, firstTurn)}`} />{t(locale, "common.self")}</button>
                </div>
                <div className="settings-grid compact-settings">
                  <label className="field-label">{t(locale, "morris.opponentReserve")}<select className="select-control" value={editOpponentToPlace} onChange={(event) => setEditOpponentToPlace(Number(event.target.value))}>{Array.from({ length: 10 }, (_, value) => <option value={value} key={value}>{value}</option>)}</select></label>
                  <label className="field-label">{t(locale, "morris.selfReserve")}<select className="select-control" value={editSelfToPlace} onChange={(event) => setEditSelfToPlace(Number(event.target.value))}>{Array.from({ length: 10 }, (_, value) => <option value={value} key={value}>{value}</option>)}</select></label>
                </div>
                <div className="field-label">{t(locale, "common.nextTurn")}<div className="segmented"><button type="button" className={`segment${editTurn === OPPONENT ? " active" : ""}`} onClick={() => setEditTurn(OPPONENT)}>{t(locale, "common.opponent")}</button><button type="button" className={`segment${editTurn === SELF ? " active" : ""}`} onClick={() => setEditTurn(SELF)}>{t(locale, "common.self")}</button></div></div>
                <div className="inline-actions"><button type="button" className="secondary-button" onClick={cancelEdit}><X size={16} />{t(locale, "common.cancel")}</button><button type="button" className="primary-button" onClick={confirmEdit}><Check size={17} />{t(locale, "common.apply")}</button></div>
              </>
            )}

            {phase === "gameover" && (
              <>
                <div className="panel-heading-row"><div><p className="eyebrow">{t(locale, "common.gameOver")}</p><h2 className="panel-title">{error ? t(locale, "common.engineError") : status.winner === SELF ? t(locale, "common.win") : t(locale, "common.loss")}</h2></div><span className="mode-badge">{t(locale, "common.finished")}</span></div>
                <div className="action-stack"><button type="button" className="primary-button" onClick={() => newGame()}><RotateCcw size={17} />{t(locale, "common.playAgain")}</button></div>
              </>
            )}
            {error && <div className="error-box">{error}</div>}
          </section>

          <section className="panel-section">
            <div className="panel-heading-row"><div><p className="eyebrow">{t(locale, "common.settingsEyebrow")}</p><h2 className="panel-title">{t(locale, "common.settings")}</h2></div><BrainCircuit size={19} aria-hidden="true" /></div>
            <div className={`settings-grid${nativeAndroid ? " single-setting" : ""}`} style={{ marginTop: 14 }}>
              <label className="field-label">{t(locale, "common.strength")}<select className="select-control" value={strength} onChange={(event) => { if (phase === "thinking") restartWorker(); setStrength(event.target.value as keyof typeof STRENGTHS); }}>{Object.entries(STRENGTHS).map(([value, preset]) => <option key={value} value={value}>{t(locale, preset.labelKey)}</option>)}</select></label>
              {!nativeAndroid && <div className="field-label">{t(locale, "common.firstTurn")}<div className="segmented"><button type="button" className={`segment${firstTurn === OPPONENT ? " active" : ""}`} onClick={() => newGame(OPPONENT)}>{t(locale, "common.opponentFirst")}</button><button type="button" className={`segment${firstTurn === SELF ? " active" : ""}`} onClick={() => newGame(SELF)}>{t(locale, "common.selfFirst")}</button></div></div>}
            </div>
            <div className="rule-note"><Crown size={15} />{phaseLabel(locale, currentPhase)}</div>
          </section>

          <section className="panel-section">
            <div className="panel-heading-row"><div><p className="eyebrow">{t(locale, "common.recentTurns")}</p><h2 className="panel-title">{t(locale, "common.history")}</h2></div><span className="count-pill">{history.length}</span></div>
            {latestHistory.length === 0 ? <div className="history-empty">{t(locale, "common.noHistory")}</div> : (
              <ol className="history-list">{latestHistory.map((entry, index) => <li className="history-row" key={`${history.length - index}-${entry.move.id}`}><span className="history-index">{history.length - index}.</span><span className={`history-side ${entry.side === OPPONENT ? "opponent" : "self"}`}>{entry.side === OPPONENT ? t(locale, "common.opponent") : t(locale, "common.self")}</span><span className="history-notation">{entry.move.notation}</span><span className="history-captures">{entry.move.remove !== null ? t(locale, "common.captured", { count: 1 }) : "—"}</span></li>)}</ol>
            )}
          </section>
        </aside>
      </div>
    </main>
  );
}
