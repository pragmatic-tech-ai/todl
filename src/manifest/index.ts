// Public surface of the manifest module (SPEC-04). Self-contained: it does not
// re-export at the package root because its numeric `MetaKind` / `Cardinality`
// enums (§3) intentionally shadow the model-layer names; consumers import from
// this subpath. Root wiring waits on the SPEC-01 `Cardinality` rename
// (journal coherence note #1).
//
// NOTE: `ManifestWriter.fromLogical(LogicalManifest)` (SPEC-04 §9.2) is NOT
// here yet — `LogicalManifest` is owned by SPEC-03, whose emitter is sequenced
// after this format core (see JOURNAL implementation order). The bridge lands
// with SPEC-03.

export { MetaKind, Cardinality, TableId, HeapId } from "./enums.js";
export { Token, TypeDefOrRef } from "./token.js";
export { ByteWriter, ByteReader, Base64 } from "./bytes.js";
export { StringsHeap } from "./strings-heap.js";
export { ConstHeap, type ConstValue } from "./const-heap.js";
export { ColKind, Column, ManifestSchema } from "./schema.js";
export { IndexWidths, type ManifestCounts } from "./index-widths.js";
export { BinarySerializer } from "./binary-codec.js";
export { ManifestWriter } from "./manifest-writer.js";
export { ManifestReader } from "./manifest-reader.js";
export { ManifestValidator, ValidationIssue, IssueSeverity } from "./manifest-validator.js";
export type {
    TypeInfoRec,
    FieldRec,
    RelRec,
    TargetRec,
    ClassRec,
    FixedRec,
    TaxonomyRec,
    ImportsRec,
    TypeRefRec,
    ManifestJson,
} from "./records.js";
