import { test } from "node:test";
import assert from "node:assert/strict";
import { GraphLayout } from "../graph-layout.js";

test("places every node at a distinct position", () => {
  const pos = new GraphLayout(["a", "b", "c"], [{ from: "a", to: "b" }, { from: "b", to: "c" }]).compute();
  assert.equal(pos.size, 3);
  const keys = new Set([...pos.values()].map((p) => `${p.x},${p.y}`));
  assert.equal(keys.size, 3);
});

test("lays a dependency chain out across increasing layers (y)", () => {
  const pos = new GraphLayout(["a", "b", "c"], [{ from: "a", to: "b" }, { from: "b", to: "c" }]).compute();
  assert.ok(pos.get("a")!.y < pos.get("b")!.y);
  assert.ok(pos.get("b")!.y < pos.get("c")!.y);
});

test("puts siblings on the same layer in different columns", () => {
  // a → b, a → c: b and c share layer 1, distinct x.
  const pos = new GraphLayout(["a", "b", "c"], [{ from: "a", to: "b" }, { from: "a", to: "c" }]).compute();
  assert.equal(pos.get("b")!.y, pos.get("c")!.y);
  assert.notEqual(pos.get("b")!.x, pos.get("c")!.x);
});

test("terminates on a cycle (back-edge dropped)", () => {
  const pos = new GraphLayout(["a", "b"], [{ from: "a", to: "b" }, { from: "b", to: "a" }]).compute();
  assert.equal(pos.size, 2);
});

test("ignores edges to unknown nodes and self-loops", () => {
  const pos = new GraphLayout(["a"], [{ from: "a", to: "ghost" }, { from: "a", to: "a" }]).compute();
  assert.equal(pos.size, 1);
  assert.deepEqual(pos.get("a"), { x: 0, y: 0 });
});
