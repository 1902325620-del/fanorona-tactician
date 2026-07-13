"use client";

import { BrainCircuit, Check, CircleAlert, Crown, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  EMPTY,
  OPPONENT,
  OPPONENT_KING,
  OPPONENT_MAN,
  SELF,
  SELF_KING,
  SELF_MAN,
  applyMove,
  countPieces,
  createInitialPosition,
  generateLegalMoves,
  getGameStatus,
  indexToPdn,
  indexToPoint,
  type DraughtsMove,
  type DraughtsPosition,
  type Piece,
  type Player,
  type SearchLine,
} from "../lib/draughts";
import { t } from "../lib/i18n";
import { pieceToneFor } from "../lib/presentation";
import { AppHeader } from "./AppHeader";
import { type AssistantNavigationProps } from "./assistantTypes";
import { GameOverNotice } from "./GameOverNotice";

type UiPhase = "opponent" | "thinking" | "recommendation" | "edit" | "gameover";

interface HistoryEntry {
  before: DraughtsPosition;
  move: DraughtsMove;
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

interface DraughtsAssistantProps extends AssistantNavigationProps {
  createWorker: () => Worker;
}

const STRENGTHS = {
  quick: { labelKey: "common.quick" as const, timeMs: 2_000, maxDepth: 7 },
  strong: { labelKey: "common.strong" as const, timeMs: 8_000, maxDepth: 11 },
  revenge: { labelKey: "common.revenge" as const, timeMs: 20_000, maxDepth: 15 },
};

function compactNumber(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(value);
}

function scoreLabel(score: number) {
  const normalized = score / 100;
  return `${normalized >= 0 ? "+" : ""}${normalized.toFixed(1)}`;
}

function isPrefix(move: DraughtsMove, route: readonly number[]) {
  return route.every((point, index) => move.route[index] === point);
}

function ownerOf(piece: Piece): Player | null {
  if (piece > 0) return SELF;
  if (piece < 0) return OPPONENT;
  return null;
}

interface DraughtsBoardProps {
  board: readonly Piece[];
  firstPlayer: Player;
  inputRoute: readonly number[];
  targets: ReadonlySet<number>;
  recommendation: DraughtsMove | null;
  interactive: boolean;
  locale: AssistantNavigationProps["locale"];
  onPoint: (index: number) => void;
}

function boardCenter(index: number) {
  const point = indexToPoint(index);
  return { x: point.col * 100 + 50, y: point.row * 100 + 50 };
}

function DraughtsBoard({
  board,
  firstPlayer,
  inputRoute,
  targets,
  recommendation,
  interactive,
  locale,
  onPoint,
}: DraughtsBoardProps) {
  const shownRoute = recommendation?.route ?? inputRoute;
  const routePoints = shownRoute.map(boardCenter).map(({ x, y }) => `${x},${y}`).join(" ");
  const captured = new Set(recommendation?.captured ?? []);

  return (
    <svg className="draughts-board" viewBox="0 0 800 800" role="grid" aria-label={t(locale, "draughts.boardAria")}>
      {Array.from({ length: 64 }, (_, cell) => {
        const row = Math.floor(cell / 8);
        const col = cell % 8;
        const playable = (row + col) % 2 === 1;
        return (
          <rect
            key={cell}
            className={`draughts-square ${playable ? "playable" : "plain"}`}
            x={col * 100}
            y={row * 100}
            width={100}
            height={100}
          />
        );
      })}

      {shownRoute.length > 1 && (
        <polyline
          className={`draughts-route${recommendation ? " recommended" : ""}`}
          points={routePoints}
        />
      )}

      {Array.from({ length: 32 }, (_, index) => {
        const point = indexToPoint(index);
        const x = point.col * 100;
        const y = point.row * 100;
        const center = boardCenter(index);
        const piece = board[index];
        const owner = ownerOf(piece);
        const king = Math.abs(piece) === 2;
        const selected = inputRoute.includes(index);
        const target = targets.has(index);
        const isCaptured = captured.has(index);
        return (
          <g
            key={index}
            role="gridcell"
            tabIndex={interactive ? 0 : -1}
            aria-label={`${indexToPdn(index)}${owner === OPPONENT ? ` ${t(locale, "common.opponent")}` : owner === SELF ? ` ${t(locale, "common.self")}` : ` ${t(locale, "common.empty")}`}${king ? ` ${t(locale, "draughts.king")}` : ""}`}
            onClick={() => interactive && onPoint(index)}
            onKeyDown={(event) => {
              if (interactive && (event.key === "Enter" || event.key === " ")) {
                event.preventDefault();
                onPoint(index);
              }
            }}
          >
            <text className="draughts-coordinate" x={x + 8} y={y + 18}>{indexToPdn(index)}</text>
            {target && <circle className="board-target" cx={center.x} cy={center.y} r={28} />}
            {piece !== EMPTY && owner !== null && (
              <>
                <circle
                  className={`board-piece ${owner === OPPONENT ? "opponent" : "self"} ${pieceToneFor(owner, firstPlayer)}${selected ? " selected" : ""}`}
                  cx={center.x}
                  cy={center.y}
                  r={33}
                />
                {king && <text className={`king-mark ${pieceToneFor(owner, firstPlayer)}`} x={center.x} y={center.y + 10}>K</text>}
              </>
            )}
            {isCaptured && (
              <g className="remove-mark">
                <line x1={center.x - 20} y1={center.y - 20} x2={center.x + 20} y2={center.y + 20} />
                <line x1={center.x + 20} y1={center.y - 20} x2={center.x - 20} y2={center.y + 20} />
              </g>
            )}
            <rect className="board-hit" x={x + 5} y={y + 5} width={90} height={90} />
          </g>
        );
      })}
    </svg>
  );
}

export function DraughtsAssistant({
  createWorker,
  active,
  game,
  locale,
  installAvailable,
  nativeAndroid,
  onGameChange,
  onInstall,
  onLocaleChange,
}: DraughtsAssistantProps) {
  const [position, setPosition] = useState<DraughtsPosition>(() => createInitialPosition(OPPONENT));
  const [firstTurn, setFirstTurn] = useState<Player>(OPPONENT);
  const [phase, setPhase] = useState<UiPhase>("opponent");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [inputRoute, setInputRoute] = useState<number[]>([]);
  const [inputNotice, setInputNotice] = useState<string | null>(null);
  const [strength, setStrength] = useState<keyof typeof STRENGTHS>("quick");
  const [searchProgress, setSearchProgress] = useState({ depth: 0, nodes: 0, timeMs: 0 });
  const [searchResult, setSearchResult] = useState<SearchState | null>(null);
  const [recommendationIndex, setRecommendationIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [workerEpoch, setWorkerEpoch] = useState(0);
  const [editBoard, setEditBoard] = useState<Piece[]>([]);
  const [editTurn, setEditTurn] = useState<Player>(OPPONENT);
  const [brush, setBrush] = useState<Piece>(OPPONENT_MAN);
  const workerRef = useRef<Worker | null>(null);
  const searchIdRef = useRef(0);

  const legalMoves = useMemo(() => generateLegalMoves(position), [position]);
  const opponentMoves = useMemo(
    () => position.turn === OPPONENT && phase !== "edit" ? legalMoves : [],
    [legalMoves, phase, position.turn],
  );
  const matchingMoves = useMemo(
    () => opponentMoves.filter((move) => isPrefix(move, inputRoute)),
    [inputRoute, opponentMoves],
  );
  const targetIndices = useMemo(() => {
    if (inputRoute.length === 0) return new Set(opponentMoves.map((move) => move.from));
    return new Set(matchingMoves.flatMap((move) => move.route[inputRoute.length] ?? []));
  }, [inputRoute.length, matchingMoves, opponentMoves]);
  const recommended = searchResult?.topMoves[recommendationIndex] ?? null;
  const displayBoard = phase === "edit" ? editBoard : position.board;
  const counts = useMemo(() => countPieces(displayBoard), [displayBoard]);
  const status = useMemo(() => getGameStatus(position), [position]);
  const hasMandatoryCapture = opponentMoves.some((move) => move.isCapture);
  const canUndo = inputRoute.length > 0 || history.length > 0;

  const restartWorker = useCallback(() => {
    searchIdRef.current += 1;
    workerRef.current?.terminate();
    workerRef.current = null;
    setWorkerEpoch((value) => value + 1);
  }, []);

  const applyRecordedMove = useCallback((move: DraughtsMove) => {
    const side = position.turn;
    const next = applyMove(position, move);
    setHistory((entries) => [...entries, { before: position, move, side }]);
    setPosition(next);
    setInputRoute([]);
    setInputNotice(null);
    setSearchResult(null);
    setRecommendationIndex(0);
    setError(null);
    const nextStatus = getGameStatus(next);
    setPhase(nextStatus.state === "won" ? "gameover" : next.turn === SELF ? "thinking" : "opponent");
  }, [position]);

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
    const clickedOwner = ownerOf(position.board[index]);
    if (inputRoute.length > 1 && clickedOwner === OPPONENT) {
      setInputNotice(t(locale, "draughts.mustContinueCapture"));
      return;
    }
    if (inputRoute.length === 1 && inputRoute[0] === index) {
      setInputRoute([]);
      setInputNotice(null);
      return;
    }
    if (inputRoute.length === 1 && clickedOwner === OPPONENT) {
      const canSwitch = opponentMoves.some((move) => move.from === index);
      if (canSwitch) {
        setInputRoute([index]);
        setInputNotice(null);
      } else {
        setInputNotice(t(locale, hasMandatoryCapture ? "draughts.mustCapture" : "draughts.noMoveForPiece"));
      }
      return;
    }
    if (inputRoute.length === 0) {
      if (targetIndices.has(index)) {
        setInputRoute([index]);
        setInputNotice(null);
      } else if (clickedOwner === OPPONENT) {
        setInputNotice(t(locale, hasMandatoryCapture ? "draughts.mustCapture" : "draughts.noMoveForPiece"));
      }
      return;
    }
    const nextRoute = [...inputRoute, index];
    const candidates = opponentMoves.filter((move) => isPrefix(move, nextRoute));
    const exact = candidates.find((move) => move.route.length === nextRoute.length);
    if (exact) applyRecordedMove(exact);
    else if (candidates.length > 0) {
      setInputRoute(nextRoute);
      setInputNotice(null);
    }
  }, [applyRecordedMove, brush, hasMandatoryCapture, inputRoute, locale, opponentMoves, phase, position.board, position.turn, targetIndices]);

  const newGame = useCallback((turn: Player = firstTurn) => {
    restartWorker();
    setPosition(createInitialPosition(turn));
    setFirstTurn(turn);
    setHistory([]);
    setInputRoute([]);
    setInputNotice(null);
    setSearchResult(null);
    setSearchProgress({ depth: 0, nodes: 0, timeMs: 0 });
    setError(null);
    setPhase(turn === SELF ? "thinking" : "opponent");
  }, [firstTurn, restartWorker]);

  const undo = useCallback(() => {
    if (inputRoute.length > 0) {
      setInputRoute((route) => route.slice(0, -1));
      setInputNotice(null);
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
  }, [history, inputRoute.length, restartWorker]);

  const beginEdit = useCallback(() => {
    restartWorker();
    setEditBoard([...position.board]);
    setEditTurn(position.turn);
    setBrush(OPPONENT_MAN);
    setInputRoute([]);
    setInputNotice(null);
    setPhase("edit");
  }, [position, restartWorker]);

  const cancelEdit = useCallback(() => {
    setError(null);
    setPhase(position.turn === SELF ? "thinking" : "opponent");
  }, [position.turn]);

  const confirmEdit = useCallback(() => {
    if (!editBoard.some((piece) => piece > 0) || !editBoard.some((piece) => piece < 0)) {
      setError(t(locale, "draughts.invalidPosition"));
      return;
    }
    const next: DraughtsPosition = { board: [...editBoard], turn: editTurn, ply: 0 };
    setPosition(next);
    setHistory([]);
    setSearchResult(null);
    setError(null);
    const nextStatus = getGameStatus(next);
    setPhase(nextStatus.state === "won" ? "gameover" : editTurn === SELF ? "thinking" : "opponent");
  }, [editBoard, editTurn, locale]);

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
        setSearchProgress({ depth: message.depth ?? 0, nodes: message.nodes ?? 0, timeMs: message.timeMs ?? 0 });
        return;
      }
      if (message.type === "error") {
        setError(message.message ?? t(locale, "common.engineRetry"));
        setPhase("gameover");
        return;
      }
      if (message.type !== "result") return;
      const topMoves = message.topMoves ?? [];
      setSearchResult({ topMoves, depth: message.depth ?? 0, nodes: message.nodes ?? 0, timeMs: message.timeMs ?? 0 });
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
    worker.postMessage({ type: "search", id, position, options: { timeMs: preset.timeMs, maxDepth: preset.maxDepth, topN: 3 } });
    return () => worker.postMessage({ type: "cancel", id });
  }, [active, locale, phase, position, strength]);

  const turnText = phase === "edit"
    ? t(locale, "draughts.turnEdit")
    : phase === "thinking"
      ? t(locale, "draughts.turnThinking")
      : phase === "recommendation"
        ? t(locale, "draughts.turnRecommend")
        : phase === "gameover"
          ? t(locale, "draughts.turnOver")
          : inputRoute.length > 1
            ? t(locale, "draughts.recordChain")
            : t(locale, "draughts.inputMove");
  const latestHistory = history.slice(-12).reverse();

  return (
    <main className={`app-shell${phase === "recommendation" ? " has-recommendation-confirm" : ""}`}>
      <AppHeader game={game} locale={locale} installAvailable={installAvailable} nativeAndroid={nativeAndroid} firstTurn={firstTurn} onGameChange={onGameChange} onInstall={onInstall} onToggleFirstTurn={() => newGame(firstTurn === OPPONENT ? SELF : OPPONENT)} onLocaleChange={onLocaleChange} canUndo={canUndo} editing={phase === "edit"} onUndo={undo} onEdit={beginEdit} onReset={() => newGame()} />
      {active && nativeAndroid && phase === "gameover" && !error && status.state === "won" && status.winner !== null && status.reason !== null && (
        <GameOverNotice
          locale={locale}
          won={status.winner === SELF}
          detail={t(locale, status.reason === "elimination"
            ? status.winner === SELF ? "draughts.endEliminationSelf" : "draughts.endEliminationOpponent"
            : status.winner === SELF ? "draughts.endBlockedSelf" : "draughts.endBlockedOpponent")}
          onRestart={() => newGame()}
        />
      )}
      <div className="workspace abstract-workspace">
        <section className="board-column" aria-label={t(locale, "draughts.boardSection")}>
          <div className="board-toolbar">
            <div className="player-label"><span className={`piece-swatch opponent ${pieceToneFor(OPPONENT, firstTurn)}`} />{t(locale, "common.opponent")}<span className="count-pill">{counts.opponentPieces}</span></div>
            <div className={`turn-indicator${phase === "thinking" ? " thinking" : phase === "opponent" ? " opponent-turn" : ""}`} title={turnText}>{turnText}</div>
            <div className="player-label"><span className="count-pill">{counts.selfPieces}</span>{t(locale, "common.self")}<span className={`piece-swatch self ${pieceToneFor(SELF, firstTurn)}`} /></div>
          </div>
          <div className="board-frame abstract-frame">
            <DraughtsBoard board={displayBoard} firstPlayer={firstTurn} inputRoute={phase === "edit" ? [] : inputRoute} targets={phase === "edit" ? new Set<number>() : targetIndices} recommendation={phase === "recommendation" ? recommended?.move ?? null : null} interactive={phase === "opponent" || phase === "edit"} locale={locale} onPoint={handleBoardPoint} />
          </div>
          {phase === "opponent" && inputNotice && (
            <div className="board-feedback" role="status" aria-live="polite">
              <CircleAlert size={16} aria-hidden="true" />
              <span>{inputNotice}</span>
            </div>
          )}
          <div className="board-footer"><span className="board-note">{t(locale, "draughts.coordinateNote")}</span><div className="legend"><span><i className="legend-dot" />{t(locale, "draughts.legalTarget")}</span><span><i className="legend-dot route" />{t(locale, "draughts.recommended")}</span></div></div>
        </section>

        <aside className="analysis-panel" aria-label={t(locale, "draughts.console")}>
          <section className="panel-section" aria-live="polite">
            {phase === "opponent" && <><div className="panel-heading-row"><div><p className="eyebrow">{t(locale, "common.opponentTurn")}</p><h2 className="panel-title">{inputRoute.length === 0 ? t(locale, "draughts.choosePiece") : t(locale, "draughts.chooseTarget")}</h2></div><span className="mode-badge opponent">{t(locale, "common.input")}</span></div>{inputRoute.length > 0 && <><div className="route-card"><div className="route-main">{inputRoute.map(indexToPdn).join(" → ")}</div></div><button type="button" className="secondary-button" onClick={() => { setInputRoute([]); setInputNotice(null); }}><X size={16} />{t(locale, "common.cancel")}</button></>}</>}
            {phase === "thinking" && <><div className="panel-heading-row"><div><p className="eyebrow">{t(locale, "common.selfTurn")}</p><h2 className="panel-title">{t(locale, "draughts.calculate")}</h2></div><span className="mode-badge thinking">{t(locale, "common.thinking")}</span></div><div className="thinking-box"><div className="spinner" aria-hidden="true" /><div className="thinking-depth">{searchProgress.depth > 0 ? t(locale, "common.searchDepth", { depth: searchProgress.depth }) : t(locale, "common.expanding")}</div><div className="thinking-nodes">{t(locale, "common.positionCount", { count: compactNumber(searchProgress.nodes) })}</div></div></>}
            {phase === "recommendation" && recommended && searchResult && <><div className="panel-heading-row"><div><p className="eyebrow">{t(locale, "common.selfTurn")}</p><h2 className="panel-title">{t(locale, "draughts.followLine")}</h2></div><span className="mode-badge">{t(locale, "common.recommendation")}</span></div>{searchResult.topMoves.length > 1 && <label className="field-label" style={{ marginTop: 14 }}>{t(locale, "common.candidateMoves")}<select className="select-control" value={recommendationIndex} onChange={(event) => setRecommendationIndex(Number(event.target.value))}>{searchResult.topMoves.map((line, index) => <option key={`${line.move.id}-${index}`} value={index}>{index === 0 ? t(locale, "common.primary") : t(locale, "common.alternative", { index })} · {line.move.notation}</option>)}</select></label>}<div className="route-card"><div className="route-main">{recommended.move.notation}</div><div className="route-summary">{recommended.move.isCapture ? t(locale, "common.captured", { count: recommended.move.captureCount }) : t(locale, "common.move")}{recommended.move.promotes && ` · ${t(locale, "draughts.king")}`}</div><div className="analysis-stats"><div className="stat"><span className="stat-label">{t(locale, "common.score")}</span><span className="stat-value">{scoreLabel(recommended.score)}</span></div><div className="stat"><span className="stat-label">{t(locale, "common.search")}</span><span className="stat-value">{t(locale, "common.depth", { depth: searchResult.depth })}</span></div><div className="stat"><span className="stat-label">{t(locale, "common.positions")}</span><span className="stat-value">{compactNumber(searchResult.nodes)}</span></div></div></div><div className="action-stack recommendation-confirm"><button type="button" className="primary-button" onClick={() => applyRecordedMove(recommended.move)}><Check size={18} />{t(locale, "common.doneInGame")}</button></div></>}
            {phase === "edit" && <><div className="panel-heading-row"><div><p className="eyebrow">{t(locale, "common.calibrate")}</p><h2 className="panel-title">{t(locale, "common.matchGame")}</h2></div><span className="mode-badge thinking">{t(locale, "common.editing")}</span></div><div className="edit-toolbar" aria-label={t(locale, "draughts.editPieces")}><button type="button" className={`brush-button${brush === OPPONENT_MAN ? " active" : ""}`} onClick={() => setBrush(OPPONENT_MAN)}><span className={`piece-swatch opponent ${pieceToneFor(OPPONENT, firstTurn)}`} />{t(locale, "common.opponent")}</button><button type="button" className={`brush-button${brush === OPPONENT_KING ? " active" : ""}`} onClick={() => setBrush(OPPONENT_KING)}><span className={`piece-swatch opponent ${pieceToneFor(OPPONENT, firstTurn)}`} /><Crown size={14} />{t(locale, "draughts.king")}</button><button type="button" className={`brush-button${brush === EMPTY ? " active" : ""}`} onClick={() => setBrush(EMPTY)}><span className="brush-empty" />{t(locale, "common.empty")}</button><button type="button" className={`brush-button${brush === SELF_MAN ? " active" : ""}`} onClick={() => setBrush(SELF_MAN)}><span className={`piece-swatch self ${pieceToneFor(SELF, firstTurn)}`} />{t(locale, "common.self")}</button><button type="button" className={`brush-button${brush === SELF_KING ? " active" : ""}`} onClick={() => setBrush(SELF_KING)}><span className={`piece-swatch self ${pieceToneFor(SELF, firstTurn)}`} /><Crown size={14} />{t(locale, "draughts.king")}</button></div><div className="field-label" style={{ marginTop: 14 }}>{t(locale, "common.nextTurn")}<div className="segmented"><button type="button" className={`segment${editTurn === OPPONENT ? " active" : ""}`} onClick={() => setEditTurn(OPPONENT)}>{t(locale, "common.opponent")}</button><button type="button" className={`segment${editTurn === SELF ? " active" : ""}`} onClick={() => setEditTurn(SELF)}>{t(locale, "common.self")}</button></div></div><div className="inline-actions"><button type="button" className="secondary-button" onClick={cancelEdit}><X size={16} />{t(locale, "common.cancel")}</button><button type="button" className="primary-button" onClick={confirmEdit}><Check size={17} />{t(locale, "common.apply")}</button></div></>}
            {phase === "gameover" && <><div className="panel-heading-row"><div><p className="eyebrow">{t(locale, "common.gameOver")}</p><h2 className="panel-title">{error ? t(locale, "common.engineError") : status.winner === SELF ? t(locale, "common.win") : t(locale, "common.loss")}</h2></div><span className="mode-badge">{t(locale, "common.finished")}</span></div><div className="action-stack"><button type="button" className="primary-button" onClick={() => newGame()}><RotateCcw size={17} />{t(locale, "common.playAgain")}</button></div></>}
            {error && <div className="error-box">{error}</div>}
          </section>

          <section className="panel-section"><div className="panel-heading-row"><div><p className="eyebrow">{t(locale, "common.settingsEyebrow")}</p><h2 className="panel-title">{t(locale, "common.settings")}</h2></div><BrainCircuit size={19} aria-hidden="true" /></div><div className={`settings-grid${nativeAndroid ? " single-setting" : ""}`} style={{ marginTop: 14 }}><label className="field-label">{t(locale, "common.strength")}<select className="select-control" value={strength} onChange={(event) => { if (phase === "thinking") restartWorker(); setStrength(event.target.value as keyof typeof STRENGTHS); }}>{Object.entries(STRENGTHS).map(([value, preset]) => <option key={value} value={value}>{t(locale, preset.labelKey)}</option>)}</select></label>{!nativeAndroid && <div className="field-label">{t(locale, "common.firstTurn")}<div className="segmented"><button type="button" className={`segment${firstTurn === OPPONENT ? " active" : ""}`} onClick={() => newGame(OPPONENT)}>{t(locale, "common.opponentFirst")}</button><button type="button" className={`segment${firstTurn === SELF ? " active" : ""}`} onClick={() => newGame(SELF)}>{t(locale, "common.selfFirst")}</button></div></div>}</div><div className="rule-note"><Crown size={15} />{t(locale, "draughts.captureRule")}</div></section>

          <section className="panel-section"><div className="panel-heading-row"><div><p className="eyebrow">{t(locale, "common.recentTurns")}</p><h2 className="panel-title">{t(locale, "common.history")}</h2></div><span className="count-pill">{history.length}</span></div>{latestHistory.length === 0 ? <div className="history-empty">{t(locale, "common.noHistory")}</div> : <ol className="history-list">{latestHistory.map((entry, index) => <li className="history-row" key={`${history.length - index}-${entry.move.id}`}><span className="history-index">{history.length - index}.</span><span className={`history-side ${entry.side === OPPONENT ? "opponent" : "self"}`}>{entry.side === OPPONENT ? t(locale, "common.opponent") : t(locale, "common.self")}</span><span className="history-notation">{entry.move.notation}</span><span className="history-captures">{entry.move.captureCount > 0 ? t(locale, "common.captured", { count: entry.move.captureCount }) : "—"}</span></li>)}</ol>}</section>
        </aside>
      </div>
    </main>
  );
}
