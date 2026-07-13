import assert from "node:assert/strict";
import test from "node:test";
import { gameName, t, translations } from "../app/lib/i18n";

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
