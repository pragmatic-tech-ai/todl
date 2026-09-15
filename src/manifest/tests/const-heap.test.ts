import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ConstHeap } from "../const-heap.js";

describe("ConstHeap — #Const (SPEC-04 §4.2)", () => {
  test("index 0 is null; interning null returns 0", () => {
    const h = new ConstHeap();
    assert.equal(h.count, 1);
    assert.equal(h.get(0), null);
    assert.equal(h.intern(null), 0);
  });

  test("intern returns 1-based indices and dedupes equal values", () => {
    const h = new ConstHeap();
    const a = h.intern(true);
    const b = h.intern("hi");
    assert.equal(a, 1);
    assert.equal(b, 2);
    assert.equal(h.intern(true), a);
    assert.equal(h.count, 3);
  });

  test("bool / i64(bigint) / f64(number) / string round-trip via bytes", () => {
    const h = new ConstHeap();
    h.intern(true);
    h.intern(false);
    h.intern(42n);
    h.intern(-9007199254740993n); // beyond Number.MAX_SAFE_INTEGER
    h.intern(3.14);
    h.intern("Компонент");
    const back = ConstHeap.fromBytes(h.toBytes());
    assert.equal(back.get(0), null);
    assert.equal(back.get(1), true);
    assert.equal(back.get(2), false);
    assert.equal(back.get(3), 42n);
    assert.equal(back.get(4), -9007199254740993n);
    assert.equal(back.get(5), 3.14);
    assert.equal(back.get(6), "Компонент");
    assert.equal(back.count, 7);
  });

  test("bigint stays bigint, number stays number (tag distinguishes)", () => {
    const h = new ConstHeap();
    const i = h.intern(5n);
    const f = h.intern(5); // same numeric magnitude, different tag
    assert.notEqual(i, f);
    const back = ConstHeap.fromBytes(h.toBytes());
    assert.equal(typeof back.get(i), "bigint");
    assert.equal(typeof back.get(f), "number");
  });

  test("empty heap round-trips to just the null sentinel", () => {
    const h = new ConstHeap();
    const back = ConstHeap.fromBytes(h.toBytes());
    assert.equal(back.count, 1);
    assert.equal(back.get(0), null);
  });

  test("size reports serialised byte length", () => {
    const h = new ConstHeap();
    h.intern("x");
    assert.equal(h.size, h.toBytes().length);
  });
});
