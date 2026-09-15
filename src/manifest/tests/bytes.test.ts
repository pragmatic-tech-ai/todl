import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ByteWriter, ByteReader } from "../bytes.js";

describe("ByteWriter / ByteReader — little-endian fixed widths", () => {
  test("u8 / u16 / u32 round-trip", () => {
    const w = new ByteWriter();
    w.u8(0x12);
    w.u16(0x3456);
    w.u32(0x89abcdef);
    const r = new ByteReader(w.toUint8Array());
    assert.equal(r.u8(), 0x12);
    assert.equal(r.u16(), 0x3456);
    assert.equal(r.u32(), 0x89abcdef); // unsigned, > 2^31
  });

  test("u32 stores little-endian", () => {
    const w = new ByteWriter();
    w.u32(0x01020304);
    const bytes = w.toUint8Array();
    assert.deepEqual(Array.from(bytes), [0x04, 0x03, 0x02, 0x01]);
  });

  test("raw bytes pass through", () => {
    const w = new ByteWriter();
    w.bytes(new Uint8Array([1, 2, 3]));
    const r = new ByteReader(w.toUint8Array());
    assert.deepEqual(Array.from(r.bytes(3)), [1, 2, 3]);
  });
});

describe("varlen(u32) — ECMA-335 §II.23.2 compressed unsigned integer", () => {
  test("1-byte form for 0..0x7F", () => {
    for (const v of [0, 1, 0x7f]) {
      const w = new ByteWriter();
      w.varlenU32(v);
      assert.equal(w.length, 1, `len@${v}`);
      assert.equal(new ByteReader(w.toUint8Array()).varlenU32(), v, `rt@${v}`);
    }
  });

  test("2-byte form for 0x80..0x3FFF (high bit 10)", () => {
    for (const v of [0x80, 0x3fff]) {
      const w = new ByteWriter();
      w.varlenU32(v);
      assert.equal(w.length, 2, `len@${v}`);
      assert.equal((w.toUint8Array()[0] & 0xc0), 0x80, `tag@${v}`);
      assert.equal(new ByteReader(w.toUint8Array()).varlenU32(), v, `rt@${v}`);
    }
  });

  test("4-byte form for 0x4000..0x1FFFFFFF (high bits 110)", () => {
    for (const v of [0x4000, 0x1fffffff]) {
      const w = new ByteWriter();
      w.varlenU32(v);
      assert.equal(w.length, 4, `len@${v}`);
      assert.equal((w.toUint8Array()[0] & 0xe0), 0xc0, `tag@${v}`);
      assert.equal(new ByteReader(w.toUint8Array()).varlenU32(), v, `rt@${v}`);
    }
  });

  test("values beyond 0x1FFFFFFF throw (out of compressed range)", () => {
    const w = new ByteWriter();
    assert.throws(() => w.varlenU32(0x20000000));
  });

  test("consecutive varlens read back in order", () => {
    const w = new ByteWriter();
    for (const v of [0, 0x7f, 0x80, 0x3fff, 0x4000, 0x1fffffff]) w.varlenU32(v);
    const r = new ByteReader(w.toUint8Array());
    for (const v of [0, 0x7f, 0x80, 0x3fff, 0x4000, 0x1fffffff]) assert.equal(r.varlenU32(), v);
  });
});

describe("alignment padding", () => {
  test("align(4) pads writer to a 4-byte boundary with zeros", () => {
    const w = new ByteWriter();
    w.u8(0xff);
    w.align(4);
    assert.equal(w.length, 4);
    assert.deepEqual(Array.from(w.toUint8Array()), [0xff, 0, 0, 0]);
  });

  test("align(4) is a no-op when already aligned", () => {
    const w = new ByteWriter();
    w.u32(1);
    w.align(4);
    assert.equal(w.length, 4);
  });

  test("reader align(4) advances position to the next boundary", () => {
    const r = new ByteReader(new Uint8Array([1, 0, 0, 0, 9]));
    r.u8();
    r.align(4);
    assert.equal(r.position, 4);
    assert.equal(r.u8(), 9);
  });
});
