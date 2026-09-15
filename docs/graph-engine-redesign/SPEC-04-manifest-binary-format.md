# SPEC-04 — Manifest Binary Format (tables + heaps)

> Part of the TODL graph-engine redesign. See [JOURNAL.md](JOURNAL.md) for the
> index and the **binding naming contract** (all names here are verbatim from
> that contract). Covers idea **#10** (internal format) plus the **cross-manifest
> `Imports`/`TypeRef` + coded-index** feedback folded in from idea **#12**.

This spec is the **on-disk encoding** of the logical manifest model defined in
SPEC-03. It is deliberately additive: a self-contained new module (`src/manifest/`)
that neither reads nor mutates the existing `Repository`/`Graph`. SPEC-03's emitter
builds the logical model; this spec serialises it.

---

## 1. Goal

Define an optimised, numeric, ECMA-335-inspired container for a TODL manifest:

- **Tables** of fixed-shape records addressed by numeric **row index** (a token);
  cross-references are row indices, never names.
- **Heaps** for variable-length data (`#Strings`, `#Const`) referenced by index.
- **Coded indices** where a reference can span tables — here exactly one:
  `TypeDefOrRef = TypeInfo | TypeRef`, the seam that makes cross-manifest
  (`Imports`/`TypeRef`) resolution possible.
- **Two serialisations that mirror each other 1:1**: a packed **binary** form
  (shipped) and a positional **JSON debug view** (derived, round-trip-tested).
- A **reader/writer** TS module surface: a writer that builds tables from the
  SPEC-03 logical model; a reader offering mmap-friendly, lazy row access keyed
  by `(table, row)` tokens.

Non-goals (deferred — see §12): annotation / operator / viewpoint / model /
package tables; the `invariants` blob encoding; `storageId`; version-conflict
binding policy (SPEC-06).

---

## 2. Design overview — ECMA-335 mapping

The format borrows CLI metadata structure. This table pins every borrowed idea
to its TODL counterpart so the design is auditable against ECMA-335 §II.22–24.

| TODL concept | CLI / ECMA-335 concept | Notes |
|---|---|---|
| `Manifest` (one file) | Assembly / module metadata | one model@version per file |
| `TypeInfo` table | `TypeDef` (§II.22.37) | concepts, primitives, taxonomies as **rows** |
| `Field` table | `Field` (§II.22.15) | declared-own scalar fields |
| `Rel` table | `Property` (§II.22.34) | reference/relationship members |
| `Target` table | (no direct analog) | per-`Rel` allowed target types |
| `Class` table | (no direct analog) | terms / value-origin providers (Axis 2) |
| `Fixed` table | `Constant` (§II.22.9) | field values a class pins, → `#Const` |
| `Taxonomy` table | (no direct analog) | represents-slice header |
| `Imports` table | `AssemblyRef` (§II.22.5) | model@version dependency list |
| `TypeRef` table | `TypeRef` (§II.22.38) | `{import, name}` — a type in a dep |
| `TypeDefOrRef` coded index | `TypeDefOrRef` (§II.24.2.6) | tag-bit encoding, low bits = tag |
| numeric row token `(table,row)` | `MetadataToken` | 1-based row; `0` = null |
| `#Strings` heap | `#Strings` stream (§II.24.2.3) | index 0 = `""` |
| `#Const` heap | `#Blob` stream (§II.24.2.4) | encoded fixed/default values |
| table/heap directories in header | `#~` metadata stream + heap-size flags (§II.24.2.6) | offsets + row counts + index widths |
| explicit `[start,count]` member slices | *(diverges)* the ECMA run-trick (list columns + next-row sentinel) | TODL uses explicit counts — no sentinel, validatable |

**Divergence called out:** ECMA derives a member run's length from the *next*
owner row's start (a sentinel trick). TODL stores an explicit `[start, count]`
per owner (e.g. `fieldStart`/`fieldCount`). This costs one `u16` per slice but
buys per-owner contiguity that is directly validatable and needs no sentinel or
"last row" special case. Slices MUST still be contiguous and non-overlapping
(see §10).

---

## 3. Enums and binary codes

Both enums are stored as **`u8`**. Codes are frozen; do not renumber.

### 3.1 `MetaKind` (u8)

| Code | Member |
|---|---|
| 0 | `Concept` |
| 1 | `Primitive` |
| 2 | `Taxonomy` |
| 3 | `Term` |
| 4 | `Annotation` |
| 5 | `Relationship` |
| 6 | `Operator` |
| 7 | `Viewpoint` |
| 8 | `Model` |
| 9 | `Package` |

> Note: this is the SPEC-03/JOURNAL `MetaKind` (adds `Term` at code 3). The
> existing runtime enum in `src/model/kinds.ts` is a **string** enum without
> `Term`; SPEC-01 reconciles it. The binary codes here are the authority for the
> `TypeInfo.kind` column. The manifest module keeps its own numeric enum and does
> **not** depend on `src/model/kinds.ts`.

### 3.2 `Cardinality` (u8)

| Code | Member | Wire glyph |
|---|---|---|
| 0 | `One` | `"1"` |
| 1 | `Optional` | `"?"` |
| 2 | `Many` | `"*"` |
| 3 | `OneOrMore` | `"+"` |

---

## 4. Heaps

Both heaps are index-addressed; **index 0 is a reserved sentinel** (empty /
null) so that `0` means "none" uniformly across every index column.

### 4.1 `#Strings`

- Logical shape: `str[]` with `strings[0] === ""`.
- Binary: length-prefixed UTF-8 entries packed back-to-back. Each entry is
  `varlen(u32) byteLength` followed by the UTF-8 bytes. The reader builds an
  offset index on load (or lazily). Index 0 is the empty string (stored as
  `byteLength = 0`).
- A `Str` column value is the **entry index** (0-based, 0 = `""`).

### 4.2 `#Const`

- Logical shape: `blob[]` of encoded fixed/default scalar values; `const[0]`
  is the empty/null blob.
- Binary: `varlen(u32) byteLength` + raw bytes per entry, packed.
- Blob encoding (v1): a 1-byte **ConstTag** then payload —
  `0x00` null (0-length), `0x01` bool (`u8` 0/1), `0x02` i64 (LE), `0x03`
  f64 (LE), `0x04` utf8-string (remaining bytes). This is the minimal set the
  current model needs; extend by adding tags (never renumber). A `Const` column
  value is the **entry index** (0 = null/empty).

> `varlen(u32)` = ECMA-style compressed unsigned integer (§II.23.2): 1/2/4 bytes
> selected by the two high bits of the first byte. Reused for heap entry lengths
> only; table columns use fixed widths (§7).

---

## 5. Tables

Rows are **1-based**; row `0` is the null row in every index column (there is no
physical row 0 — `rowCount` counts real rows `1..rowCount`). Member slices are
**explicit `[start, count]`**; `count = 0` means empty (and `start` is ignored,
by convention emitted as `0`).

Column "indexes" tells which table/heap a numeric column addresses.

### 5.1 `TypeInfo` (≈ `TypeDef`)

| Column | Type | Width | Meaning | Indexes |
|---|---|---|---|---|
| `name` | `Str` | heap-idx | type name | `#Strings` |
| `ns` | `Str` | heap-idx | namespace (0 = none) | `#Strings` |
| `kind` | `u8` | 1 | `MetaKind` code | — |
| `extends` | `TypeDefOrRef` | coded | base type (0 = none / virtual `Element`) | `TypeInfo`\|`TypeRef` |
| `fieldStart` | `Field` | tbl-idx | first declared field row | `Field` |
| `fieldCount` | `u16` | 2 | number of declared fields | — |
| `relStart` | `Rel` | tbl-idx | first declared relationship row | `Rel` |
| `relCount` | `u16` | 2 | number of declared relationships | — |

### 5.2 `Field` (≈ `Field`)

| Column | Type | Width | Meaning | Indexes |
|---|---|---|---|---|
| `name` | `Str` | heap-idx | field name | `#Strings` |
| `type` | `TypeDefOrRef` | coded | field value type | `TypeInfo`\|`TypeRef` |
| `card` | `u8` | 1 | `Cardinality` code | — |

### 5.3 `Rel` (≈ `Property`)

| Column | Type | Width | Meaning | Indexes |
|---|---|---|---|---|
| `name` | `Str` | heap-idx | relationship name | `#Strings` |
| `targetStart` | `Target` | tbl-idx | first target row | `Target` |
| `targetCount` | `u16` | 2 | number of targets | — |
| `card` | `u8` | 1 | `Cardinality` code | — |
| `inverse` | `Str` | heap-idx | inverse relationship name (0 = none) | `#Strings` |

### 5.4 `Target`

| Column | Type | Width | Meaning | Indexes |
|---|---|---|---|---|
| `type` | `TypeDefOrRef` | coded | one allowed target type | `TypeInfo`\|`TypeRef` |

### 5.5 `Class` (terms / value-origin providers — Axis 2)

| Column | Type | Width | Meaning | Indexes |
|---|---|---|---|---|
| `name` | `Str` | heap-idx | class/term id (the `localId`) | `#Strings` |
| `type` | `TypeDefOrRef` | coded | the concept the class is-a | `TypeInfo`\|`TypeRef` |
| `taxonomy` | `Taxonomy` | tbl-idx | owning taxonomy (0 = none) | `Taxonomy` |
| `broader` | `Class` | tbl-idx | broader term (0 = root) | `Class` |
| `fixedStart` | `Fixed` | tbl-idx | first pinned value row | `Fixed` |
| `fixedCount` | `u16` | 2 | number of pinned values | — |

> `narrower` is **not** stored; it is the reverse of `broader` and rebuilt by the
> reader as an index if SPEC-05 needs it (avoids a second source of truth).

### 5.6 `Fixed`

| Column | Type | Width | Meaning | Indexes |
|---|---|---|---|---|
| `field` | `Field` | tbl-idx | which field is pinned | `Field` |
| `value` | `Const` | heap-idx | the pinned value blob | `#Const` |

### 5.7 `Taxonomy`

| Column | Type | Width | Meaning | Indexes |
|---|---|---|---|---|
| `name` | `Str` | heap-idx | taxonomy name | `#Strings` |
| `representsStart` | `Target` | tbl-idx | first represented-concept row | `Target` |
| `representsCount` | `u16` | 2 | number of represented concepts | — |

> `represents` reuses the `Target` table (each row a `TypeDefOrRef`), so a
> taxonomy can represent a concept defined in a dependency. `roots` (top-level
> terms) is derived by the reader as `Class` rows where `broader = 0` and
> `taxonomy` = this taxonomy.

### 5.8 `Imports` (≈ `AssemblyRef`)

| Column | Type | Width | Meaning | Indexes |
|---|---|---|---|---|
| `model` | `Str` | heap-idx | dependency model name | `#Strings` |
| `version` | `Str` | heap-idx | dependency version string | `#Strings` |

### 5.9 `TypeRef` (≈ `TypeRef`)

| Column | Type | Width | Meaning | Indexes |
|---|---|---|---|---|
| `import` | `Imports` | tbl-idx | which dependency declares the type | `Imports` |
| `name` | `Str` | heap-idx | fully-qualified type name in the dep | `#Strings` |

> The reader resolves a `TypeRef` to a concrete `TypeInfo` in another manifest at
> the **Domain** layer (SPEC-06): `Imports` → loaded `Manifest` → `getType(name)`.
> The manifest file itself only stores the *reference*, never the resolved row.

---

## 6. Coded index — `TypeDefOrRef`

A single coded index spans `TypeInfo` and `TypeRef`. Encoding follows ECMA-335
§II.24.2.6: **low bits = table tag, high bits = 1-based row index**.

- **Tag bits:** 1 (two tables → 1 tag bit).
- **Tag values:** `0 = TypeInfo`, `1 = TypeRef`.
- **Encoding:** `coded = (row << 1) | tag`, where `row` is the 1-based row in the
  tagged table.
- **Null:** `coded = 0` (`row = 0, tag = 0`) means "none". This is why `TypeInfo`
  row 0 does not exist — the null slot is reserved.
- **Decoding:** `tag = coded & 1`; `row = coded >>> 1`.

**Width selection (ECMA §II.24.2.6 rule):** the coded-index width is `u16` if the
larger of the two indexable tables fits in the remaining bits, else `u32`.
Concretely: coded value ≤ `0xFFFF` ⇒ `u16`, else `u32`. With 1 tag bit, `u16`
holds rows `1..32767` per table; if either `TypeInfo` **or** `TypeRef` has
`> 32767` rows the coded column widens to `u32`. The chosen width is recorded per
column-group in the header **index-width flags** (§7.4), exactly like ECMA
heap-size flags.

> Only `extends`, `Field.type`, `Target.type`, and `Class.type` are
> `TypeDefOrRef`. This is the single place the coded-index idea from #10 is
> actually exercised, and it is the seam #12 needs for cross-manifest `extends`.

---

## 7. Binary container layout

Little-endian throughout. `TODM` = "TODl Manifest".

### 7.1 Header

Fixed-prefix header, then two directories:

```
Header {
  magic       : u32   // ASCII "TODM" = 0x4D444F54 (LE bytes 'T','O','D','M')
  formatVer   : u16   // container format version (this spec = 1)
  reserved    : u16   // 0; carries index-width & heap-size flags (see §7.4)
  model       : Str   // heap index into #Strings (model name)
  modelVer    : Str   // heap index into #Strings (model version)
  root        : TypeInfo  // 1-based row of the root type (virtual Element); may be 0
  tableCount  : u8
  heapCount   : u8
  tableDir    : TableDirEntry[tableCount]
  heapDir     : HeapDirEntry[heapCount]
}

TableDirEntry { id:u8, recordSize:u16, rowCount:u32, offset:u32 }
HeapDirEntry  { id:u8, offset:u32, size:u32 }
```

- `offset` fields are **absolute byte offsets from the start of the file**.
- `recordSize` is the packed byte size of one row **for that file** (it depends
  on the chosen index widths — §7.4), enabling `rowOffset = tableDir.offset + (row-1) * recordSize` for O(1), mmap-friendly random access.
- `model`/`modelVer` are heap indices, so the `#Strings` heap must be locatable
  from the header alone; readers resolve them after mapping the heap directory.

### 7.2 Table IDs

Stable `u8` ids (frozen; append-only):

| id | table |
|---|---|
| 0 | `TypeInfo` |
| 1 | `Field` |
| 2 | `Rel` |
| 3 | `Target` |
| 4 | `Class` |
| 5 | `Fixed` |
| 6 | `Taxonomy` |
| 7 | `Imports` |
| 8 | `TypeRef` |

Heap IDs: `0 = #Strings`, `1 = #Const`.

### 7.3 Stream order

```
[ Header + directories ]
[ TypeInfo stream ]  (rowCount * recordSize, packed)
[ Field stream ]
[ Rel stream ]
[ Target stream ]
[ Class stream ]
[ Fixed stream ]
[ Taxonomy stream ]
[ Imports stream ]
[ TypeRef stream ]
[ #Strings heap ]
[ #Const heap ]
```

Order is the recommended layout; **consumers MUST use the directory offsets**,
not assume adjacency (mirrors ECMA — streams are located via `#~`). Streams
SHOULD be 4-byte aligned; the writer pads with zero bytes and the directory
`offset` reflects the padded position.

### 7.4 Index-width flags (ECMA heap-size analog)

The `reserved` `u16` in the header is a **flags word** recording, per widenable
index family, whether it was emitted as `u16` (bit clear) or `u32` (bit set):

| Bit | Family | Widen when |
|---|---|---|
| 0 | `#Strings` heap index | `strings.length > 0xFFFF` |
| 1 | `#Const` heap index | `const.length > 0xFFFF` |
| 2 | `TypeInfo` row index | `TypeInfo.rowCount > 0xFFFF` |
| 3 | `Field` row index | `Field.rowCount > 0xFFFF` |
| 4 | `Rel` row index | `Rel.rowCount > 0xFFFF` |
| 5 | `Target` row index | `Target.rowCount > 0xFFFF` |
| 6 | `Class` row index | `Class.rowCount > 0xFFFF` |
| 7 | `Fixed` row index | `Fixed.rowCount > 0xFFFF` |
| 8 | `Taxonomy` row index | `Taxonomy.rowCount > 0xFFFF` |
| 9 | `Imports` row index | `Imports.rowCount > 0xFFFF` |
| 10 | `TypeRef` row index | `TypeRef.rowCount > 0xFFFF` |
| 11 | `TypeDefOrRef` coded | `max(coded value) > 0xFFFF` (§6) |
| 12–15 | reserved | 0 |

A plain (non-coded) row-index column widens on **its own** table's flag; a coded
column widens on bit 11. `recordSize` in the table directory is computed from the
resolved widths so a reader can size rows without re-deriving flags (but it
SHOULD cross-check).

> Simplification allowed for v1: a writer MAY choose a **uniform u32** policy
> (set all width flags) for correctness-first bring-up, then enable the u16
> narrowing optimisation once boundary tests (§11) pass. The reader honours the
> flags regardless.

---

## 8. JSON debug view

Derived, human-legible, and a **positional 1:1 mirror** of the binary (same
column order, same numeric indices — *not* names, *not* resolved values). Its
sole purpose is round-trip verification and eyeballing; it is never shipped.

```jsonc
{
  "format": "todl-manifest/1",     // == formatVer
  "model": "shop",                  // resolved from header.model (convenience)
  "version": "1.2.0",               // resolved from header.modelVer
  "root": 1,                        // header.root (TypeInfo row, coded? no — plain row)
  "strings": ["", "Component", "shop", "Surface", ...],   // #Strings, index 0 = ""
  "const":   ["", "AQ==", ...],     // #Const, base64 per blob, index 0 = ""
  "tables": {
    "TypeInfo": [
      // [ name, ns, kind, extends, fieldStart, fieldCount, relStart, relCount ]
      [1, 2, 0, 0, 1, 3, 1, 1]
    ],
    "Field":    [ /* [name, type, card] */ [4, 6, 0] ],
    "Rel":      [ /* [name, targetStart, targetCount, card, inverse] */ ],
    "Target":   [ /* [type] */ ],
    "Class":    [ /* [name, type, taxonomy, broader, fixedStart, fixedCount] */ ],
    "Fixed":    [ /* [field, value] */ ],
    "Taxonomy": [ /* [name, representsStart, representsCount] */ ],
    "Imports":  [ /* [model, version] */ ],
    "TypeRef":  [ /* [import, name] */ ]
  }
}
```

Rules:
- Every table row is an **array of column values in binary column order**.
- Index columns hold the **same integers** as the binary (heap indices, 1-based
  row indices, coded `TypeDefOrRef` values). `extends` in the example is `0`
  (none); a coded value like `3` means `TypeInfo` row 1 with tag 1 → decode per §6.
- `const[]` entries are **base64** of the raw blob bytes (tag byte + payload),
  so the JSON is pure ASCII and round-trips byte-exact.
- Rows appear in **row order**; array position `i` is logical row `i+1`.
- The JSON carries **no** width flags — widths are a binary concern; JSON→binary
  re-derives them from row/heap counts (§7.4).

---

## 9. Reader / Writer module API

Module: `src/manifest/` (new, self-contained). Object-oriented per repo
conventions — no free functions; behaviour hangs off classes. All types below
are TS signatures.

### 9.1 Shared types

```ts
export const enum TableId {
  TypeInfo = 0, Field = 1, Rel = 2, Target = 3, Class = 4,
  Fixed = 5, Taxonomy = 6, Imports = 7, TypeRef = 8,
}
export const enum HeapId { Strings = 0, Const = 1 }

export enum MetaKind { Concept, Primitive, Taxonomy, Term, Annotation,
  Relationship, Operator, Viewpoint, Model, Package }        // codes 0..9
export enum Cardinality { One, Optional, Many, OneOrMore }    // codes 0..3

/** A location within ONE manifest: (table, row). Row is 1-based; 0 = null. */
export class Token {
  constructor(readonly table: TableId, readonly row: number) {}
  get isNull(): boolean;                 // row === 0
  static readonly Null: Token;
  equals(other: Token): boolean;
}

/** Decoded TypeDefOrRef (§6): a Token in either TypeInfo or TypeRef. */
export class TypeDefOrRef {
  constructor(readonly toTypeRef: boolean, readonly row: number) {}
  static decode(coded: number): TypeDefOrRef;   // row 0 => null
  encode(): number;                              // (row<<1)|tag
  get isNull(): boolean;
  toToken(): Token;                              // TableId.TypeInfo | TypeRef
}
```

### 9.2 Writer

The writer consumes the SPEC-03 **logical model** and produces bytes / JSON. It
interns strings and blobs into heaps, allocates contiguous member slices, and
computes index widths.

```ts
/** Builds heaps + tables incrementally, then serialises. Row ids returned by
 *  add* are 1-based and stable for the life of the builder. */
export class ManifestWriter {
  constructor(model: string, version: string);

  // Heap interning (idempotent; returns index, 0 for "" / null).
  internString(s: string): number;
  internConst(value: ConstValue): number;        // ConstValue = null|boolean|bigint|number|string

  // Row appenders (return 1-based row). Slices must be added contiguously:
  // add all Fields for a type, capture [start,count], then addTypeInfo.
  addTypeInfo(rec: TypeInfoRec): number;
  addField(rec: FieldRec): number;
  addRel(rec: RelRec): number;
  addTarget(rec: TargetRec): number;
  addClass(rec: ClassRec): number;
  addFixed(rec: FixedRec): number;
  addTaxonomy(rec: TaxonomyRec): number;
  addImport(rec: ImportsRec): number;
  addTypeRef(rec: TypeRefRec): number;

  setRoot(typeInfoRow: number): void;

  /** Serialise to the shipped binary container (§7). */
  toBinary(): Uint8Array;
  /** Serialise to the JSON debug view (§8). */
  toJSON(): ManifestJson;

  /** Convenience: build directly from the SPEC-03 logical manifest. */
  static fromLogical(m: LogicalManifest): ManifestWriter;
}
```

`*Rec` interfaces carry already-interned indices (e.g. `TypeInfoRec.name: number`
is a `#Strings` index, `extends: number` is an encoded `TypeDefOrRef`), so the
writer performs no name resolution — it is a pure packer.

### 9.3 Reader

Reader is **lazy and mmap-friendly**: it wraps the underlying `Uint8Array` (or a
`DataView` over an mmap buffer) and computes row offsets on demand. No table is
eagerly decoded; a row read is `offset + (row-1)*recordSize` plus per-column
slices. Derived indices (e.g. term `narrower`, taxonomy `roots`) are built lazily
and cached on first request.

```ts
export class ManifestReader {
  static fromBinary(bytes: Uint8Array): ManifestReader;
  static fromJSON(json: ManifestJson): ManifestReader;   // for debug/round-trip

  readonly model: string;
  readonly version: string;
  readonly formatVersion: number;
  readonly root: Token;                    // TypeInfo token (or Token.Null)

  rowCount(table: TableId): number;
  heapSize(heap: HeapId): number;

  // Heap access.
  getString(index: number): string;        // 0 => ""
  getConst(index: number): ConstValue;     // 0 => null

  // Raw row access (decoded record structs). Bounds-checked; row 0 => throws.
  typeInfo(row: number): TypeInfoRec;
  field(row: number): FieldRec;
  rel(row: number): RelRec;
  target(row: number): TargetRec;
  class_(row: number): ClassRec;
  fixed(row: number): FixedRec;
  taxonomy(row: number): TaxonomyRec;
  import_(row: number): ImportsRec;
  typeRef(row: number): TypeRefRec;

  // Coded index helper.
  decodeTypeRef(coded: number): TypeDefOrRef;

  // Slice iterators (fieldStart/Count etc.) — lazy generators.
  fieldsOf(typeInfoRow: number): IterableIterator<FieldRec>;
  relsOf(typeInfoRow: number): IterableIterator<RelRec>;
  targetsOf(relRow: number): IterableIterator<TargetRec>;
  fixedOf(classRow: number): IterableIterator<FixedRec>;
  representsOf(taxonomyRow: number): IterableIterator<TargetRec>;

  /** Emit the JSON debug view from the loaded binary (round-trip seam). */
  toJSON(): ManifestJson;
}
```

> `ManifestReader` is the substrate SPEC-05's `Manifest`/`TypeInfo`/etc. wrap.
> SPEC-06's `DomainToken = (manifestId, table, row)` composes a manifest id with a
> `Token`; the reader here is manifest-local only and resolves `TypeRef`s no
> further than returning the decoded `{import, name}` — Domain does the hop.

---

## 10. Validation & consistency rules

Enforced by a `ManifestValidator` (a class over a `ManifestReader`), run in tests
and optionally at load:

1. **Header**: `magic == "TODM"`; `formatVer == 1`; `model`/`modelVer` heap
   indices in range; `root` is 0 or a valid `TypeInfo` row.
2. **Directory**: each `tableDir` `id` is a known `TableId`, unique; `offset +
   rowCount*recordSize` within file bounds; heaps likewise; `recordSize` matches
   the width-flag-derived size.
3. **No dangling indices**: every `Str` column ∈ `[0, strings.length)`; every
   `Const` column ∈ `[0, const.length)`; every plain row index ∈ `[0,
   table.rowCount]` (0 allowed = null); every `TypeDefOrRef` decodes to row ∈
   `[0, TypeInfo|TypeRef.rowCount]`.
4. **Slice integrity**: for each `[start,count]` slice, `count == 0` ⇒ ignored;
   else `start ≥ 1` and `start + count - 1 ≤ referenced.rowCount`. Slices for the
   same target table SHOULD be contiguous and non-overlapping across owners
   (writer guarantees this; validator flags overlap as a warning, gap as fine).
5. **Enum ranges**: `kind ∈ 0..9`; every `card ∈ 0..3`.
6. **Coded tag**: `TypeDefOrRef` tag bit ∈ {0,1}; tag 1 (TypeRef) requires
   `TypeRef.rowCount > 0`.
7. **Imports/TypeRef**: every `TypeRef.import` ∈ `[1, Imports.rowCount]`;
   `Imports.model`/`version` non-empty (index ≠ 0).
8. **Root kind**: if `root ≠ 0`, `TypeInfo[root].kind` SHOULD be `Concept` (the
   virtual `Element`); non-fatal warning otherwise.
9. **Const tag**: each referenced `#Const` blob begins with a known `ConstTag`.

Cross-manifest referential integrity (does a `TypeRef` actually resolve in a
loaded dependency?) is **out of scope here** — it is a SPEC-06/Domain check.

---

## 11. Testing strategy

TDD, tests under `src/manifest/tests/` (repo rule). Layers:

1. **Heap round-trip**: intern strings/consts (incl. `""`, null, unicode,
   i64/f64/bool) → serialise heap → read back byte-exact; index 0 sentinel holds.
2. **Coded index unit**: `TypeDefOrRef.encode/decode` for tag 0/1, row 0
   (null), min/max rows; u16↔u32 selection.
3. **In-memory → JSON → in-memory**: build via `ManifestWriter`, `toJSON()`,
   `ManifestReader.fromJSON()`, compare structurally.
4. **In-memory → binary → in-memory**: `toBinary()` then
   `ManifestReader.fromBinary()`, compare all rows + heaps.
5. **Binary ↔ JSON parity**: `ManifestReader.fromBinary(bytes).toJSON()` deep-
   equals `writer.toJSON()`; and `fromJSON(json).toBinary()` byte-equals
   `writer.toBinary()` (1:1 mirror guarantee).
6. **Index-width boundary at 65535**: synthesise tables/heaps with exactly
   65535 and 65536 rows/entries; assert the correct width flag flips, `recordSize`
   changes, and round-trip still holds on both sides of the boundary. Also the
   coded-index boundary (bit 11) at the 32767/32768 row mark.
7. **Cross-manifest**: a manifest with `Imports` + `TypeRef` + an `extends` that
   is a `TypeRef`-tagged `TypeDefOrRef`; round-trip and confirm the reader returns
   the decoded `{import, name}` (no resolution attempted).
8. **Validator**: negative tests — dangling string index, out-of-range coded
   row, bad enum code, slice overrun, unknown table id, wrong magic — each caught.
9. **mmap-shape access**: read a single deep row (e.g. `Fixed` #N) without
   iterating prior rows; assert offset math via `recordSize`.

Golden files: check in one small `.todm` + its `.json` mirror as a fixture for
regression on the byte layout.

---

## 12. Open questions (deferred)

- **Annotation / Operator / Viewpoint / Model / Package tables** — analogous
  fixed-shape tables (annotation *definitions* vs *applications* split still
  open, per JOURNAL). Reserve `TableId` 9+ for them; append-only so today's
  files stay readable. `MetaKind` already has their codes.
- **`invariants` blob** — opaque expression blob in `#Const` (or a dedicated
  `#Invariants` heap) for v1; representation TBD in SPEC-03.
- **`storageId`** — not in the manifest (it is a data-graph concern, deferred in
  SPEC-01); no column here.
- **Version-conflict binding** across `Imports` (unify / pin / redirect) — a
  SPEC-06 policy; the format only records `model@version`, it does not resolve.
- **`#Const` tag set** — extend beyond the v1 tags (arrays/refs?) as the value
  model grows; append tags only.
- **Compression / alignment** — streams are uncompressed and 4-byte aligned in
  v1; a compressed variant could bump `formatVer`.

---

## 13. Implementation tasks (bite-sized, TDD)

1. Enums + codes (`MetaKind`, `Cardinality`, `TableId`, `HeapId`) + a frozen-code
   test.
2. `Token` + `TypeDefOrRef` classes with encode/decode + unit tests (§11.2).
3. `#Strings` heap writer/reader (varlen-prefixed UTF-8, index-0 sentinel) + §11.1.
4. `#Const` heap writer/reader (ConstTag encoding, base64 for JSON) + §11.1.
5. `*Rec` record interfaces (all-numeric columns) mirroring §5.
6. `ManifestWriter`: heap interning + row appenders + slice capture (no
   serialisation yet) + builder-level tests.
7. `ManifestWriter.toJSON()` (§8) + `ManifestReader.fromJSON()` + §11.3.
8. Index-width flag computation (§7.4) as a pure step over final row/heap counts.
9. `ManifestWriter.toBinary()` (header, directories, packed streams, heaps) + §11.4.
10. `ManifestReader.fromBinary()` (directory parse, lazy row structs, slice
    iterators) + §11.4 + §11.9.
11. Binary↔JSON parity harness (§11.5) + golden fixtures.
12. Index-width boundary tests at 65535 / 32767 (§11.6).
13. `Imports`/`TypeRef` tables + `TypeDefOrRef` cross-manifest round-trip (§11.7).
14. `ManifestValidator` + negative tests (§11.8, §10).
15. `ManifestWriter.fromLogical(...)` bridge to the SPEC-03 logical model (thin;
    finalised once SPEC-03 lands).
