// Manifest-local references (SPEC-04 §6, §9.1).
//
// A `Token` is a (table, row) location within ONE manifest; row 0 is the
// null slot in every table. A `TypeDefOrRef` is a coded index into the pair
// {TypeInfo | TypeRef}: the low bit tags which table, the high bits carry the
// 1-based row. Encoding is ARITHMETIC (row * 2 + tag), not bitwise `<<`, so
// u32-range rows survive without signed-32-bit overflow.

import { TableId } from "./enums.js";

/** A (table, row) location inside one manifest. Row 0 = the null slot. */
export class Token
{
    constructor(readonly table: TableId, readonly row: number) {}

    /** The null token: row 0 of the TypeInfo table. */
    static readonly Null: Token = new Token(TableId.TypeInfo, 0);

    /** True when this token points at row 0 (the per-table null slot). */
    get isNull(): boolean
    {
        return this.row === 0;
    }

    /** Structural equality: same table AND same row. */
    equals(other: Token): boolean
    {
        return this.table === other.table && this.row === other.row;
    }
}

/**
 * A coded index over the {TypeInfo | TypeRef} pair (SPEC-04 §6).
 * Tag 0 selects TypeInfo, tag 1 selects TypeRef; the row is 1-based.
 */
export class TypeDefOrRef
{
    constructor(readonly toTypeRef: boolean, readonly row: number) {}

    /** Encode to `row * 2 + tag`; row 0 collapses to 0 (null) for both tags. */
    encode(): number
    {
        if (this.row === 0) return 0;
        return this.row * 2 + (this.toTypeRef ? 1 : 0);
    }

    /** Decode a coded index back into tag + 1-based row. */
    static decode(coded: number): TypeDefOrRef
    {
        if (coded === 0) return new TypeDefOrRef(false, 0);
        const toTypeRef = (coded % 2) === 1;
        const row = (coded - (coded % 2)) / 2;
        return new TypeDefOrRef(toTypeRef, row);
    }

    /** True when this refers to row 0 (null). */
    get isNull(): boolean
    {
        return this.row === 0;
    }

    /** Widen to a full `Token` in the tagged table. */
    toToken(): Token
    {
        return new Token(this.toTypeRef ? TableId.TypeRef : TableId.TypeInfo, this.row);
    }
}
