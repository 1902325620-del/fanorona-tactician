import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMorrisDebugRecord,
  copyMorrisDebugRecord,
  type MorrisHistoryEntry,
  type MorrisSearchState,
} from "../app/components/MorrisAssistant";
import { gameName, t, translations } from "../app/lib/i18n";
import {
  EMPTY,
  OPPONENT,
  SELF,
  algebraicToIndex,
  createInitialPosition,
  type MorrisCell,
  type MorrisMove,
  type MorrisPosition,
} from "../app/lib/morris";

test("Chinese and English catalogs expose the same message keys", () => {
  assert.deepEqual(
    Object.keys(translations.zh).sort(),
    Object.keys(translations.en).sort(),
  );
});

test("translations cover all three games and interpolate values", () => {
  assert.equal(gameName("zh", "fanorona"), "迂棋");
  assert.equal(gameName("en", "draughts"), "English Draughts");
  assert.equal(gameName("en", "morris"), "Nine Men's Morris");
  assert.equal(t("zh", "common.depth", { depth: 7 }), "7 层");
  assert.equal(t("en", "common.depth", { depth: 7 }), "Depth 7");
});

test("Morris debug record preserves the full move, board, reserves, and last search", () => {
  const board = Array<MorrisCell>(24).fill(EMPTY);
  board[algebraicToIndex("a7")] = SELF;
  board[algebraicToIndex("d6")] = OPPONENT;
  const position: MorrisPosition = {
    board,
    turn: OPPONENT,
    selfToPlace: 3,
    opponentToPlace: 4,
    ply: 11,
  };
  const capture: MorrisMove = {
    id: "debug-capture",
    player: SELF,
    kind: "place",
    from: null,
    to: algebraicToIndex("a7"),
    remove: algebraicToIndex("b6"),
    formsMill: true,
    notation: "@a7xb6",
  };
  const lastSearch: MorrisSearchState = {
    depth: 9,
    nodes: 123_456,
    timeMs: 2_001.4,
    score: 275,
    engine: "wasm",
    placementTargetDepth: 14,
    placementComplete: false,
    timedOut: true,
    topMoves: [{ move: capture, score: 275, pv: [capture] }],
  };
  const history: MorrisHistoryEntry[] = [{
    before: createInitialPosition(SELF),
    move: capture,
    side: SELF,
    search: lastSearch,
  }];

  const record = JSON.parse(buildMorrisDebugRecord({
    version: "2.1.0-alpha.1",
    firstTurn: SELF,
    strength: "quick",
    position,
    history,
    lastSearch,
  }));

  assert.equal(record.schema, "board-tactician/morris-debug-record/v1");
  assert.equal(record.appVersion, "2.1.0-alpha.1");
  assert.equal(record.firstPlayer, "self");
  assert.deepEqual(record.strength, { id: "quick", timeMs: 2_000, maxDepth: 32 });
  assert.deepEqual(record.moves[0], {
    turn: 1,
    side: "self",
    kind: "place",
    from: null,
    to: "a7",
    remove: "b6",
    formsMill: true,
    notation: "@a7xb6",
    search: {
      engine: "wasm",
      depth: 9,
      score: 275,
      nodes: 123_456,
      timeMs: 2_001,
      placementTargetDepth: 14,
      placementComplete: false,
      timedOut: true,
      candidates: [{
        rank: 1,
        score: 275,
        move: {
          side: "self",
          kind: "place",
          from: null,
          to: "a7",
          remove: "b6",
          formsMill: true,
          notation: "@a7xb6",
        },
        pv: [{
          side: "self",
          kind: "place",
          from: null,
          to: "a7",
          remove: "b6",
          formsMill: true,
          notation: "@a7xb6",
        }],
      }],
    },
  });
  assert.equal(record.currentPosition.turn, "opponent");
  assert.equal(record.currentPosition.selfToPlace, 3);
  assert.equal(record.currentPosition.opponentToPlace, 4);
  assert.equal(record.currentPosition.board.a7, "self");
  assert.equal(record.currentPosition.board.d6, "opponent");
  assert.equal(record.currentPosition.board.g1, "empty");
  assert.equal(record.lastSearch.depth, 9);
  assert.equal(record.lastSearch.engine, "wasm");
  assert.equal(record.lastSearch.score, 275);
  assert.equal(record.lastSearch.nodes, 123_456);
  assert.equal(record.lastSearch.placementTargetDepth, 14);
  assert.equal(record.lastSearch.placementComplete, false);
  assert.equal(record.lastSearch.timedOut, true);
  assert.equal(record.lastSearch.candidates[0].move.remove, "b6");
  assert.equal(record.lastSearch.candidates[0].pv[0].notation, "@a7xb6");
});

test("Morris debug record reports Clipboard API success and failure", async () => {
  let copiedText = "";
  const copied = await copyMorrisDebugRecord("record", {
    writeText: async (text) => { copiedText = text; },
  });
  assert.equal(copied, true);
  assert.equal(copiedText, "record");

  const rejected = await copyMorrisDebugRecord("record", {
    writeText: async () => { throw new Error("permission denied"); },
  }, (text) => text === "record");
  assert.equal(rejected, true);
  assert.equal(await copyMorrisDebugRecord("record", undefined, () => true), true);
  assert.equal(await copyMorrisDebugRecord("record", undefined, undefined), false);
});
