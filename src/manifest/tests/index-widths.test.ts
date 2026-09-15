import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { IndexWidths } from "../index-widths.js";
import { TableId, HeapId } from "../enums.js";

const EMPTY = {
  strings: 1, consts: 1,
  typeInfo: 0, field: 0, rel: 0, target: 0, class: 0,
  fixed: 0, taxonomy: 0, imports: 0, typeRef: 0,
};

describe("IndexWidths — u16/u32 selection + reserved flags (SPEC-04 §7.4)", () => {
  test("empty manifest: everything u16, reserved flags = 0", () => {
    const w = IndexWidths.fromCounts(EMPTY);
    assert.equal(w.reserved, 0);
    assert.equal(w.heapWidth(HeapId.Strings), 2);
    assert.equal(w.heapWidth(HeapId.Const), 2);
    assert.equal(w.rowWidth(TableId.TypeInfo), 2);
    assert.equal(w.codedWidth(), 2);
  });

  test("#Strings widens at length > 0xFFFF (bit 0)", () => {
    assert.equal(IndexWidths.fromCounts({ ...EMPTY, strings: 0xffff }).heapWidth(HeapId.Strings), 2);
    const w = IndexWidths.fromCounts({ ...EMPTY, strings: 0x10000 });
    assert.equal(w.heapWidth(HeapId.Strings), 4);
    assert.equal((w.reserved & (1 << 0)) !== 0, true);
  });

  test("#Const widens at length > 0xFFFF (bit 1)", () => {
    const w = IndexWidths.fromCounts({ ...EMPTY, consts: 0x10000 });
    assert.equal(w.heapWidth(HeapId.Const), 4);
    assert.equal((w.reserved & (1 << 1)) !== 0, true);
  });

  test("a plain row index widens on its own table's flag (Field = bit 3)", () => {
    assert.equal(IndexWidths.fromCounts({ ...EMPTY, field: 0xffff }).rowWidth(TableId.Field), 2);
    const w = IndexWidths.fromCounts({ ...EMPTY, field: 0x10000 });
    assert.equal(w.rowWidth(TableId.Field), 4);
    assert.equal((w.reserved & (1 << 3)) !== 0, true);
    // sibling tables unaffected
    assert.equal(w.rowWidth(TableId.TypeInfo), 2);
  });

  test("TypeDefOrRef coded widens when max(TypeInfo,TypeRef) row > 32767 (bit 11)", () => {
    // 32767 rows: max coded = 32767*2+1 = 65535 -> still u16
    assert.equal(IndexWidths.fromCounts({ ...EMPTY, typeInfo: 32767 }).codedWidth(), 2);
    // 32768 rows: max coded = 65537 -> u32
    const w = IndexWidths.fromCounts({ ...EMPTY, typeInfo: 32768 });
    assert.equal(w.codedWidth(), 4);
    assert.equal((w.reserved & (1 << 11)) !== 0, true);
    // driven by TypeRef too
    assert.equal(IndexWidths.fromCounts({ ...EMPTY, typeRef: 40000 }).codedWidth(), 4);
  });

  test("reserved flags round-trip: fromFlags reproduces the same widths", () => {
    const src = IndexWidths.fromCounts({ ...EMPTY, strings: 0x10000, field: 0x10000, typeInfo: 40000 });
    const back = IndexWidths.fromFlags(src.reserved);
    assert.equal(back.heapWidth(HeapId.Strings), 4);
    assert.equal(back.rowWidth(TableId.Field), 4);
    assert.equal(back.codedWidth(), 4);
    assert.equal(back.rowWidth(TableId.Rel), 2);
    assert.equal(back.reserved, src.reserved);
  });
});
