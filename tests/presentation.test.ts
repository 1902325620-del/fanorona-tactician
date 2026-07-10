import assert from "node:assert/strict";
import test from "node:test";
import { OPPONENT, SELF } from "../app/lib/fanorona";
import { pieceToneFor } from "../app/lib/presentation";

test("the first player is light when our side starts", () => {
  assert.equal(pieceToneFor(SELF, SELF), "light");
  assert.equal(pieceToneFor(OPPONENT, SELF), "dark");
});

test("piece colors swap when the opponent starts", () => {
  assert.equal(pieceToneFor(OPPONENT, OPPONENT), "light");
  assert.equal(pieceToneFor(SELF, OPPONENT), "dark");
});
