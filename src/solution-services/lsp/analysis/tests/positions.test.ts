import { test } from "node:test";
import assert from "node:assert/strict";
import { Positions } from "../positions.js";

test("Positions.SpanToRange converts 1-based/exclusive TODL spans to 0-based LSP ranges", () => {
  const range = Positions.SpanToRange({ uri: "d.todl", start: { line: 3, column: 16 }, end: { line: 3, column: 22 } });
  assert.deepEqual(range, { start: { line: 2, character: 15 }, end: { line: 2, character: 21 } });
});

test("Positions.PositionToTodl is the inverse for a point", () => {
  assert.deepEqual(Positions.PositionToTodl({ line: 2, character: 15 }), { line: 3, column: 16 });
});

test("Positions.RangeToSpan round-trips SpanToRange", () => {
  const span = { uri: "d.todl", start: { line: 3, column: 16 }, end: { line: 3, column: 22 } };
  assert.deepEqual(Positions.RangeToSpan("d.todl", Positions.SpanToRange(span)), span);
});
