import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { StringsHeap } from "../strings-heap.js";

describe("StringsHeap — #Strings (SPEC-04 §4.1)", () => {
  test("index 0 is the empty string, always present", () => {
    const h = new StringsHeap();
    assert.equal(h.count, 1);
    assert.equal(h.get(0), "");
    assert.equal(h.intern(""), 0);
  });

  test("intern returns 1-based indices and is idempotent", () => {
    const h = new StringsHeap();
    const a = h.intern("Component");
    const b = h.intern("shop");
    assert.equal(a, 1);
    assert.equal(b, 2);
    assert.equal(h.intern("Component"), a); // dedupes
    assert.equal(h.count, 3); // "", Component, shop
    assert.equal(h.get(a), "Component");
    assert.equal(h.get(b), "shop");
  });

  test("serialise → fromBytes round-trips exactly, index 0 sentinel holds", () => {
    const h = new StringsHeap();
    h.intern("Surface");
    h.intern("shop");
    h.intern("Компонент"); // unicode
    const back = StringsHeap.fromBytes(h.toBytes());
    assert.equal(back.get(0), "");
    assert.equal(back.get(1), "Surface");
    assert.equal(back.get(2), "shop");
    assert.equal(back.get(3), "Компонент");
    assert.equal(back.count, 4);
  });

  test("bytes are byte-exact across two serialisations of equal heaps", () => {
    const a = new StringsHeap();
    const b = new StringsHeap();
    for (const s of ["x", "yy", "zzz"]) { a.intern(s); b.intern(s); }
    assert.deepEqual(Array.from(a.toBytes()), Array.from(b.toBytes()));
  });

  test("empty heap serialises to just the index-0 entry and round-trips", () => {
    const h = new StringsHeap();
    const back = StringsHeap.fromBytes(h.toBytes());
    assert.equal(back.count, 1);
    assert.equal(back.get(0), "");
  });

  test("size reports serialised byte length", () => {
    const h = new StringsHeap();
    h.intern("ab");
    assert.equal(h.size, h.toBytes().length);
  });
});
