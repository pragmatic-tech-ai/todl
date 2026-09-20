import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Token, TypeDefOrRef } from "../token.js";
import { TableId } from "../enums.js";

describe("Token — a (table, row) location within one manifest", () => {
  test("row 0 is null; Token.Null is a null TypeInfo slot", () => {
    assert.equal(new Token(TableId.Field, 0).isNull, true);
    assert.equal(new Token(TableId.Field, 1).isNull, false);
    assert.equal(Token.Null.isNull, true);
    assert.equal(Token.Null.table, TableId.TypeInfo);
    assert.equal(Token.Null.row, 0);
  });

  test("equals compares table AND row", () => {
    assert.equal(new Token(TableId.Class, 3).equals(new Token(TableId.Class, 3)), true);
    assert.equal(new Token(TableId.Class, 3).equals(new Token(TableId.Class, 4)), false);
    assert.equal(new Token(TableId.Class, 3).equals(new Token(TableId.Field, 3)), false);
  });
});

describe("TypeDefOrRef — coded index over TypeInfo | TypeRef (SPEC-04 §6)", () => {
  test("encode is (row<<1)|tag; tag 0 = TypeInfo, tag 1 = TypeRef", () => {
    assert.equal(new TypeDefOrRef(false, 1).encode(), 2); // TypeInfo row 1 -> (1<<1)|0
    assert.equal(new TypeDefOrRef(true, 1).encode(), 3);  // TypeRef  row 1 -> (1<<1)|1
    assert.equal(new TypeDefOrRef(false, 5).encode(), 10);
    assert.equal(new TypeDefOrRef(true, 5).encode(), 11);
  });

  test("row 0 encodes to 0 (null) regardless of tag; decode(0) is null", () => {
    assert.equal(new TypeDefOrRef(false, 0).encode(), 0);
    assert.equal(new TypeDefOrRef(true, 0).encode(), 0);
    assert.equal(TypeDefOrRef.decode(0).isNull, true);
  });

  test("decode splits tag (low bit) and 1-based row (high bits)", () => {
    const a = TypeDefOrRef.decode(2);
    assert.equal(a.toTypeRef, false);
    assert.equal(a.row, 1);
    const b = TypeDefOrRef.decode(11);
    assert.equal(b.toTypeRef, true);
    assert.equal(b.row, 5);
  });

  test("encode/decode round-trips for both tags across a range", () => {
    for (const toRef of [false, true])
    {
      for (const row of [1, 2, 32767, 32768, 1_000_000])
      {
        const coded = new TypeDefOrRef(toRef, row).encode();
        const back = TypeDefOrRef.decode(coded);
        assert.equal(back.toTypeRef, toRef, `tag@${row}`);
        assert.equal(back.row, row, `row@${row}`);
      }
    }
  });

  test("u32-range rows survive encode (no 32-bit bitwise overflow)", () => {
    // row beyond 2^30 would overflow a signed 32-bit (row<<1); arithmetic must hold.
    const row = 2_000_000_000;
    const coded = new TypeDefOrRef(true, row).encode();
    const back = TypeDefOrRef.decode(coded);
    assert.equal(back.row, row);
    assert.equal(back.toTypeRef, true);
  });

  test("toToken maps tag to the right table", () => {
    assert.equal(TypeDefOrRef.decode(2).toToken().table, TableId.TypeInfo);
    assert.equal(TypeDefOrRef.decode(3).toToken().table, TableId.TypeRef);
    assert.equal(TypeDefOrRef.decode(3).toToken().row, 1);
  });
});
