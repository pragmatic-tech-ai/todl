# TODL Graph Engine Redesign — Spec Journal

Root tracker for the graph-engine + manifest + reflection + domain redesign.
Source of the design: a captured idea dump (12 ideas) that converged, via Q&A,
into the architecture specced here. This journal is the single index; each spec
is a sibling file. Implementation status is tracked at the bottom.

> Provenance: the raw idea dump lived in the session scratchpad
> (`graph-engine-ideas.md`). The relevant content is folded into the specs;
> this journal supersedes it as the authoritative index.

## The shape (top to bottom)

```
Domain            ApplicationDomain analog: loads/unloads manifests from Packages,
  │               holds ONE runtime graph (the heap), is the reflection root      [SPEC-06]
  ├─ Manifest(s)  assemblies: ECMA-335-style tables + heaps, numeric tokens,
  │               cross-referenced via Imports/TypeRef + coded indices            [SPEC-03/04]
  │    └─ Reflection API   System.Reflection surface: TypeInfo / FieldInfo /
  │                        TermInfo / InstanceMirror, two provenance axes         [SPEC-05]
  └─ Graph        the heap: flattened, self-contained instance nodes that
                  reference manifest types by token                               [SPEC-01/02]
```

Founding principle (drives every spec): **`attrs` holds user data only;
meta/structural information lives at the node root or in the manifest — never
denormalized into the data graph.** Inheritance is applied at compile time
(flattened onto nodes) yet preserved as structure (in the manifest), so the data
graph stays clean and shardable while validation / reflection / subtype queries /
round-trip all keep working.

## Specs

| Spec | Title | Covers ideas | Status |
|------|-------|--------------|--------|
| [SPEC-01](SPEC-01-node-and-edge-model.md) | Node & Edge Model | #1 namespace-root, #2 operator edges, #3 storage-id, #4 scalar→attr/ref→edge, #5 attrs-user-only + isClass + localId, #6 MetaKind.Term | drafted |
| [SPEC-02](SPEC-02-inheritance-flattening.md) | Inheritance Flattening & Virtual Element | #7 | drafted |
| [SPEC-03](SPEC-03-manifest-model.md) | Manifest Model (logical) | #8, #9 | drafted |
| [SPEC-04](SPEC-04-manifest-binary-format.md) | Manifest Binary Format (tables + heaps) | #10, cross-manifest tables from #12 | **implemented** (core; fromLogical deferred to SPEC-03) |
| [SPEC-05](SPEC-05-reflection-api.md) | Reflection API | #11 | drafted |
| [SPEC-06](SPEC-06-domain.md) | Domain (ApplicationDomain) | #12 | drafted |

**Coverage verified** (grep-checked, all six drafts on disk): every idea #1–#12 has its signature present in the mapped spec above; no idea orphaned.

## Shared naming contract (BINDING across all specs)

All specs MUST use these names verbatim so the layers fit together.

**Node root fields** (structural, NOT in `attrs`):
- `id` — logical/hierarchical graph identifier (e.g. `Components.Surface`). Unchanged role.
- `localId` — the node's own short id segment (e.g. `Surface`). Was `attrs.id`. (Chosen over shortId/termId/name; `name` avoided — collides with the `Element.name` field.)
- `storageId` — dedicated persistence id (#3), distinct from `id`. **DEFERRED** (open: minting, stability, store role) — reserve the field, don't block on it.
- `namespace` — was `attrs.namespace` (#1).
- `type` — the concept the node is typed by (a manifest `TypeInfo` token / concept id). Replaces the instance-tier meaning of `typeOf`.
- `class` — for an instance that is-a term/class: the `TermInfo`/Class token (#9 Axis-2 hook). Optional (0/undefined = none).
- `isClass` — boolean, was `attrs.class` (#5).
- `metaKind` — for ontology nodes, the language construct (see `MetaKind`); `Term` is now first-class (#6).
- `attrs` — user-defined scalar attributes ONLY.

**Enums:**
- `MetaKind { Concept, Primitive, Taxonomy, Term, Annotation, Relationship, Operator, Viewpoint, Model, Package }` — adds `Term` to the existing `src/model/kinds.ts` enum. Binary codes 0..9 as in SPEC-04.
- `Cardinality { One, Optional, Many, OneOrMore }` — wire glyphs `"1" "?" "*" "+"`, binary codes 0..3.
- `EdgeKind` — reference/relationship edges only in the data graph (NO `Extends`/`Contains`/`HasField`-for-scalars). Retain `Relationship`, `Narrower`, `InstanceOf`, `Targets`, `Represents`, `Annotated`, `Frames` as applicable; see SPEC-01/02 for the final set.

**Manifest tables** (SPEC-04): `TypeInfo`, `Field`, `Rel`, `Target`, `Class`, `Fixed`, `Taxonomy`, `Imports`, `TypeRef`. **Heaps:** `#Strings`, `#Const`.
Member slices are explicit `[start,count]` (no ECMA run-trick). `0` = null/none in any index column. Cross-table type references are coded indices `TypeDefOrRef = TypeInfo | TypeRef`.

**Reflection classes** (SPEC-05): `Manifest`, `TypeInfo`, `MemberInfo` (abstract), `FieldInfo`, `RelationshipInfo`, `TermInfo`, `TaxonomyInfo`, `AnnotationInfo`, `InstanceMirror`, `FieldView`.

**Domain** (SPEC-06): `Domain`, `PackageSource`, `PackageRef`, `DomainToken = (manifestId, table, row)`.

**Two provenance axes** (the recurring vocabulary):
- Axis 1 — **type/field-definition origin**: which concept declared a field; travels `extends`; surfaced as `MemberInfo.declaringType`.
- Axis 2 — **value origin**: whether a flattened instance value came from its class/term or is the instance's own; travels `class`/`instanceOf`; surfaced as `FieldView.valueOrigin`.

## Implementation order (dependency-driven)

1. **SPEC-04 format core** — enums, table/heap data structures, tokens, JSON reader/writer, then binary reader/writer. Self-contained new module; no change to existing model. Round-trip tests (binary↔JSON↔in-memory).
2. **SPEC-03 emitter** — build a manifest (+ flattened data graph) from the existing `Repository`. Targets the current model first; refined as SPEC-01/02 land.
3. **SPEC-05 reflection** — the read API over a loaded manifest (both axes).
4. **SPEC-06 Domain** — package loading, one graph, reflection endpoint, cross-manifest resolution, lifecycle.
5. **SPEC-01 / SPEC-02 graph model cleanup** — node root fields, `attrs` user-only, `MetaKind.Term`, scalar→attr/ref→edge, flattening, virtual `Element`. Changes the emitted graph; sequenced last so the manifest pipeline exists to consume the cleaned shape.

Rationale: the manifest subsystem (04/03/05/06) is **additive** and can be built and tested without destabilizing the live model; the graph-model cleanups (01/02) then reshape what the emitter produces, validated by the pipeline already in place.

## Open questions (rolled up; owned by the noted spec)

- Short-id name settled as `localId`; `storageId` (#3) deferred — minting authority, reload stability, store role. (SPEC-01)
- `invariants` encoding — opaque expression blob for v1. (SPEC-03/04)
- Annotation **definitions** vs **applications** table split. (SPEC-03/04)
- `operators` / `viewpoints` / `models` / `package` tables — analogous, detailed later. (SPEC-04)
- Cross-dep **version-conflict binding policy** (unify / pin / redirect). (SPEC-06)
- Index width u16↔u32 per referenced-table size (ECMA heap-size flags). (SPEC-04)

## Coherence reconciliations (post-draft; decisions within the decided design)

Surfaced by the six drafts; these bind implementation so the layers fit.

1. **`Cardinality` rename.** ✅ **DONE (2026-09-16, out of SPEC-01 order).** Unified on the manifest's numeric enum `{ One, Optional, Many, OneOrMore }` in `src/manifest/enums.ts` (single canonical owner; frozen codes 0..3); `src/model/graph.ts` re-exports it (leaf → no cycle, manifest stays lean). All `NonEmpty` usages renamed across validate/reactive/parser/signature-help/js-module/read-client + test; docs updated. 757 tests green, typecheck clean. This also removes the `Cardinality` name-collision that blocked the manifest root re-export (see SPEC-04 deferral).
2. **`MetaKind` reconcile.** SPEC-01 adds `Term` to `src/model/kinds.ts`. `MetaKind.Field` retirement is coupled to #4 (scalar members → manifest `Field` records) — tracked, not blocking. The **binary** `MetaKind` (SPEC-04) is an independent numeric enum; the SPEC-03→binary bridge MAPS names→codes, never casts.
3. **Operator endpoint `EdgeKind` (#2).** Real edges need a concrete kind — finalize in SPEC-01 impl (reuse a relationship-style edge with `via` = from/to, or a dedicated kind); must be in SPEC-02's trimmed `EdgeKind` set.
4. **`typeOf` split.** `type` (instance concept) + `metaKind` (ontology construct). Sweep every `node.typeOf` reader on migration — owner SPEC-01.
5. **Virtual-root vs stored extends.** Manifest stores `extends = 0` for a parent-less concept; `TypeInfo.baseType` and `schemaOf` resolve `0 → Element` by the rule. Consistent (SPEC-02/05).
6. **Token composition.** Manifest-local `Token = (table,row)`; `DomainToken = (manifestId,table,row)` wraps it, same tag scheme. `Manifest.resolveToken` narrow; `Domain.resolveToken` widens.
7. **Package-type naming collision (highest).** Repo ALREADY exports `PackageRef` (registry `{scope?,name,version?}`, `src/package-manager/registry/npm-registry.ts`) and `PackageSource` (authored source `{name,text}`, `src/package-manager/package-manager.ts`). **Decision:** Domain does NOT add a new `PackageSource` — it **reuses the existing registry `PackageRef`**, and its manifest-resolver dependency is named **`ManifestProvider`** (backed by the existing `PackageManager` façade + `resolveClosure`). Apply this rename to SPEC-06 at implementation.
8. **Annotation defs-vs-applications tables.** Deferred; `getAnnotations()` assumes an applications table SPEC-03/04 will add. Open.
9. **`subtypesOf` / reverse-extends.** No per-handle reverse; provided by a Manifest-level scan or a Domain index. Open (SPEC-05/06).

### Existing package infra the Domain builds on (found by SPEC-06)
- `src/package-manager/package-manager.ts` — `PackageManager` façade (`getPackage`/`getContent`/`getContents`); backend for `ManifestProvider`.
- `src/package-manager/registry/npm-registry.ts` — `NpmRegistry` wire client (packument/tarball/publish, SRI).
- `src/package-manager/resolve.ts` — `InstalledPackage` / `resolveClosure` (deps-first) / `composeClosure`; `meta: TodlPackageMeta {kind,id}` = model identity; `document` = today's compiled payload (`TodlDocument`, bridged to SPEC-04 bytes during migration).
- `src/package-manager/registry/tar-reader.ts`, `manifest.ts` (`ProjectManifest`, `DependencyRef {id,version}`), `package-json.ts` (`TodlPackageMeta`). `src/publish/` (`publish.ts`, `reflect.ts`, `stores.ts`). No `PackageStore`/`compilePackage` class exists.

## Implementation log

_(append newest-last; one line per meaningful step)_

- 2026-09-15 — journal + all six specs drafted (parallel); coverage verified (all #1–#12); coherence reconciliations recorded above. Next: SPEC-04 format core (TDD).
- 2026-09-16 — **SPEC-04 format core DONE** on branch `todl_20` (TDD, 73 tests, typecheck-clean). Module `src/manifest/`: `enums` (numeric MetaKind/Cardinality/TableId/HeapId), `token` (Token + TypeDefOrRef coded index), `bytes` (ByteWriter/ByteReader + varlen(u32) + Base64), `strings-heap` / `const-heap` (#Strings, #Const with ConstTag i64/f64/bool/str), `records` (`*Rec` + `ManifestJson`), `schema` (shared column order/width — single source of truth), `index-widths` (u16/u32 + reserved flags), `binary-codec` (`BinarySerializer`, one serializer for writer+reader), `manifest-writer` (interning + row appenders + toJSON + toBinary), `manifest-reader` (fromBinary/fromJSON + typed row accessors + slice iterators + toBinary/toJSON), `manifest-validator` (§10 rules 1,3–9), `index` barrel. Golden hex fixture + binary↔JSON parity (both directions) + 65535 width-boundary all round-trip. **Deferred:** `ManifestWriter.fromLogical(LogicalManifest)` → lands with SPEC-03 (owns `LogicalManifest`). Next: SPEC-03 emitter (build manifest + flattened graph from the live `Repository`).
- 2026-09-16 — **Coherence #1 resolved** (pulled ahead of SPEC-01 at user request): `Cardinality` unified on `src/manifest/enums.ts` (canonical owner), `model/graph.ts` re-exports; `NonEmpty → OneOrMore` swept repo-wide; docs updated. Removes the name-collision that blocked the manifest root re-export. 757 tests green.
