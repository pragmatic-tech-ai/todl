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
| [SPEC-01](SPEC-01-node-and-edge-model.md) | Node & Edge Model | #1 namespace-root, #2 operator edges, #3 storage-id, #4 scalar→attr/ref→edge, #5 attrs-user-only + isClass + localId, #6 MetaKind.Term | **implemented** — full `typeOf`→`type`+`metaKind` split + root fields (#1/#3/#5) + `MetaKind.Term` (#6, dual term) + attrs-user-only (blocklist deleted) + Contains-must-be-Term validation + **#4 `HasField` removed** (field schema now carried on the owner node via `Node.fields`; `EdgeKind.HasField` gone). **#2 (operator endpoint edges) DEFERRED with evidence** — see coherence notes / log |
| [SPEC-02](SPEC-02-inheritance-flattening.md) | Inheritance Flattening & Virtual Element | #7 | **implemented** (virtual root rule; flatten-emit already delivered by SPEC-03 emitter) |
| [SPEC-03](SPEC-03-manifest-model.md) | Manifest Model (logical) | #8, #9 | **implemented** |
| [SPEC-04](SPEC-04-manifest-binary-format.md) | Manifest Binary Format (tables + heaps) | #10, cross-manifest tables from #12 | **implemented** (incl. fromLogical bridge) |
| [SPEC-05](SPEC-05-reflection-api.md) | Reflection API | #11 | **implemented** |
| [SPEC-06](SPEC-06-domain.md) | Domain (ApplicationDomain) | #12 | **implemented** (core; RegistryPackageSource deferred) |

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
3. **Operator endpoint `EdgeKind` (#2).** ⏸️ **DEFERRED at SPEC-01 impl (2026-09-16) with evidence.** The operator's `from`/`to` are **member-name strings** (bound at `loader.ts` `mintReifiedEdge`), not concept references; the only concept the operator points at is already a real `Targets` edge. So there are no *separate* concept endpoints to edge-ify, and the spec's own Open Questions leaves the edge kind unfixed. Making from/to "real edges" would require resolving each member's declared target type — schema work coupled to #4, not a clean SPEC-01 change. Left as scalar attrs on the operator node (unchanged behaviour); revisit with #4 / the manifest schema source.
4. **`typeOf` split.** ✅ **DONE at SPEC-01 impl (2026-09-16).** `type` (instance concept) + `metaKind` (ontology construct) on `Node`; store dual-indexes `byType` (on `type`) and new `byMetaKind` (on `metaKind`, via `nodesOfMetaKind`). Swept every `node.typeOf` reader across 20 src + 38 test files. Record **identity** now lives in the root `localId` (was the `id` attr — the `id` attr is deleted, not just moved), so `attrs` is genuinely user-only and `effectiveFields`/`checkOverride` need no marker blocklist (deleting the blocklist without this fixed-a-regression: leaf-vs-class `id` differs per-instance and would false-positive as a `ClassOverride`).
5. **Virtual-root vs stored extends.** Manifest stores `extends = 0` for a parent-less concept; `TypeInfo.baseType` and `schemaOf` resolve `0 → Element` by the rule. Consistent (SPEC-02/05).
6. **Token composition.** Manifest-local `Token = (table,row)`; `DomainToken = (manifestId,table,row)` wraps it, same tag scheme. `Manifest.resolveToken` narrow; `Domain.resolveToken` widens.
7. **Package-type naming collision (highest).** ~~Decision: Domain reuses registry `PackageRef` + renames resolver to `ManifestProvider`.~~ **SUPERSEDED at SPEC-06 impl (2026-09-16).** The domain tier works in TODL `model@version`; the registry tier in npm `name@version` — reusing registry `PackageRef` conflates model-id with npm-name. Followed SPEC-06's own approach instead: **domain-tier `PackageRef`{model,version?} + `PackageSource`(resolver) live in `src/domain/`**; when the registry types must be referenced (in the deferred `RegistryPackageSource` adapter) they are **aliased** (`import { PackageRef as RegistryRef }`). Domain-tier names win in the `src/domain/` surface per the binding contract.
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
- 2026-09-16 — **SPEC-03 logical manifest + emitter DONE** on `todl_20` (TDD, 22 tests, typecheck-clean, full suite 779 green). `src/manifest/logical.ts`: `LogicalManifest`/`ConceptDef`/`ClassDef`/`RelationshipDef`/`FieldDef`/`TaxonomyDef` + `CardinalityGlyph` (enum↔glyph) + `ManifestModel` (`typeOriginOf` Axis-1, `valueOriginOf` Axis-2, `ancestorsViaExtends`, JSON-identity `toJSON`/`fromJSON`). `src/emit/manifest.ts`: `ManifestEmitter` builds the logical manifest (declared-only via `schemaOf`, classes/taxonomies) + the flattened data graph (`DataGraph`/`DataNode`/`DataEdge`) from a live `Repository`; additive, does not touch `toJSON`. **SPEC-03 reconciliation (RECORDED):** the data-graph flatten is **instance-wins** (instance own value overrides class fixed; class fills only unset fields), NOT `Repository.effectiveFields` (which is **class-wins**, per its doc + model.ts:246-258). Reason: Axis-2 value-origin is only meaningful if an instance value *can* differ from its class — under class-wins a class-fixed field always equals the class, so `valueOriginOf` could never return "self" for it. Instance-wins is also the SPEC-01 target. `effectiveFields` stays the class-wins resolution for validation / typed clients; the emitter intentionally diverges. `effectiveRelationships` (union) is reused as-is for edges. **Deferred still:** `ManifestWriter.fromLogical(LogicalManifest)` (SPEC-04 §9.2) — the bridge that lowers this logical manifest to SPEC-04 binary tables — now unblocked (both types exist); next candidate. Next per order: SPEC-05 reflection API over a loaded manifest.
- 2026-09-16 — **SPEC-02 virtual-Element root rule DONE + SPEC-01 T1 (`MetaKind.Term`) DONE** on `todl_20` (TDD, +6 tests, full suite 826 green, typecheck-clean). `supertypesOf`/`schemaOf` (`src/model/model.ts`) now resolve "parent-less concept ⇒ `Element`" by a concept-scoped, idempotent RULE (annotations exempt); the loader (`src/parse/loader.ts`) no longer stages a synthetic `Extends → Element` edge. **The `Element` super-node is eliminated** — its `Extends` reverse-adjacency went from N (one per concept) to 0; resolution walks outward only. `implicit-element.test.ts` still green (behaviour preserved through the rule). `MetaKind.Term = "term"` added to `src/model/kinds.ts`. SPEC-02's flatten-emit / edge-omission (T5/T6) were **already delivered** by the SPEC-03 `ManifestEmitter` (instance-wins flatten + marker strip + relationship-only edges), so the data-graph side needs no further change. **SPEC-01 remaining = the large in-model Node reshape** (`typeOf` → `type`+`metaKind`, root `namespace`/`localId`/`isClass`/`class`/`storageId`, attrs-user-only, blocklist deletion, operator endpoint edges, scalar→attr/ref→edge, JSON round-trip): **117 `typeOf` sites across 20 src + 38 test files** — a multi-file surgery whose *external* payoff (clean flattened data-graph + manifest) is already delivered by SPEC-03–06. Left OPEN pending a scope decision; the marker-blocklist and node-shape reconciliations recorded for SPEC-05/06 anticipate it.
- 2026-09-16 — **SPEC-06 Domain DONE** (core) on `todl_20` (TDD, 15 tests, full suite 820 green, typecheck-clean). `src/domain/domain.ts`: `Domain implements ManifestHost` with the three hats — (1) loader: async `load` (deps-first, dedup by `model@version`, register-before-recurse cycle guard, `onResolveManifest` synchronous fallback ≈ AssemblyResolve, version pinning via `versions()`), `tryUnload` (Guard A graph-refcount evict-own/refuse-foreign + Guard B import-refcount + dep-refcount cascade), `manifests`/`getManifest`/load+unload Signals; (2) the one `Heap` of flattened nodes + `bindGraph` with seed attribution; (3) reflection root `getType("model:fullName")`/`resolveToken(DomainToken)`/`reflect`. **Cross-manifest payoff wired:** SPEC-05 reflection `Manifest` gained a `ManifestHost` back-link (a real interface, not a seam-bag) + `resolveTypeRef` now hops a `TypeRef` via `Imports → host.getManifest → getType`, so `TypeInfo.baseType` crosses a package boundary — the one place SPEC-04's coded `TypeDefOrRef` is finally exercised end-to-end. **Reconciliations (recorded):** (a) **naming** — followed SPEC-06's own approach (domain-tier `PackageRef`{model,version} + `PackageSource` isolated in `src/domain/`, alias registry types in the adapter) over journal note #7's earlier "reuse registry PackageRef + rename to ManifestProvider": the domain works in TODL `model@version`, the registry in npm `name@version` — conflating them is wrong; note #7 is superseded. (b) **heap shape** — `Domain.graph` is a `Heap` of flattened `ReflectedNode`s (type/class as ids), not `src/model/graph.ts` `Graph` (which lacks node-root type/class tokens — the SPEC-01 shape); same family as SPEC-05 reflection. **Deferred:** `RegistryPackageSource` adapter (SPEC-06 task 12) — needs packages to ship SPEC-04 manifest bytes, which the publish pipeline does not yet emit; the `PackageSource` seam is in place and tested with an in-memory fake. Next per order: SPEC-01 / SPEC-02 graph-model cleanup (the last phase; reshapes what the emitter produces + retires the marker blocklist / node-root shape these two reconciliations anticipate).
- 2026-09-16 — **SPEC-05 reflection API DONE** on `todl_20` (TDD, 18 tests, full suite 805 green, typecheck-clean). `src/manifest/reflection/reflection.ts` (single cohesive module to avoid ESM class-extends-undefined cycles; `Manifest` is the handle factory): `Manifest` (load binary|JSON, `getType`/`types`/`root`/`getTerm`/`getTaxonomy`/`resolveToken`/`reflect`), `TypeInfo` (`baseType`, declared vs effective `getFields`/`getRelationships` with subtype-wins + preserved `declaringType` = **Axis 1**, `isSubtypeOf`/`isAssignableFrom`/`getSupertypes`), `MemberInfo`/`FieldInfo`/`RelationshipInfo` (`getValue` w/ class-fixed fallback, `getTargets`), `TermInfo`/`TaxonomyInfo` (`fixes`/`getFixedValue`/`findFixing` broader-walk, `roots`/`getTerms`/`represents`), `AnnotationInfo`, `InstanceMirror`+`FieldView` (`definitionOrigin` Axis 1, `valueOrigin` Axis 2). Numeric `Token = table*2^32+row`; handles equal by `.token`. Repository parity cross-check guards the supersede claim. **Two recorded shape decisions:** (1) reflection consumes the FLATTENED data node (`type`/`class`/`attrs`/`refs`), NOT `src/model/graph.ts` Node — the spec's `Node` import is inconsistent with the node-root shape it actually uses (that's the SPEC-01 shape); the reflection node interface is local + structural so there's no `src/emit` import cycle. (2) `getAnnotations()`/`getInvariants()` return `[]` — SPEC-04 v1 has no annotation-application or invariant table (deferred); handle classes exist so the surface is stable when those tables land. Next per order: SPEC-06 Domain.
- 2026-09-16 — **`fromLogical` bridge DONE** on `todl_20` (TDD, 8 tests + 1 e2e, full suite 787 green, typecheck-clean). `ManifestWriter.fromLogical(LogicalManifest)` lowers SPEC-03's logical manifest to SPEC-04 binary tables: concepts→`TypeInfo` (kind Concept); any referenced type id not a declared concept (primitives like `string`, or external names in single-manifest v1) is synthesized as a local `Primitive` `TypeInfo` so every coded ref resolves in-manifest (cross-manifest `Imports`/`TypeRef` stays SPEC-06). Field/Rel/Target/Class/Fixed/Taxonomy slices built in dependency-safe passes with precomputed row maps; `Fixed.field` resolved via `ManifestModel.typeOriginOf`. End-to-end `Repository → ManifestEmitter → fromLogical → toBinary → ManifestReader` validates. **This closes the last SPEC-04 deferral.** logical types exported from the manifest barrel. Next per order: SPEC-05 reflection API.
- 2026-09-16 — **SPEC-01 #4 `HasField` removed** on `todl_20` (TDD, full suite **835 green**, typecheck-clean; user directive "HasField has to go" overrode the earlier deferral). A concept's / annotation's **declared field schema now lives on the owner node** as `Node.fields: FieldDecl[]` (`{name, type, cardinality}`) — no more `HasField` member nodes (`Concept.fieldName`, metaKind Field) and no `HasField` edge; **`EdgeKind.HasField` is deleted**. `Builder.addField` stages a field-decl applied at commit via new `Graph.addFieldDecl`/`GraphStore.addFieldDecl` (the loader defines a concept in Pass 1 then its fields in Pass 2a — separate commits — so the decl appends to the already-committed owner node). `schemaOf` reads `node.fields` instead of walking `HasField`; **its output is unchanged, so validation, the loader's reference-resolution, the manifest emitter, codegen, and hover all keep working untouched** — this is why the deferral's blocker (schemaOf being the sole schema source) dissolved: the source moved, the shape didn't. `JsonNode.fields` + the Cypher store (fields persisted as a JSON column) round-trip it. `HasRelationship` member nodes stay (they carry navigable `Targets` edges). `MetaKind.Field` is now unused (no field member nodes) but kept in the enum (retirement still coupled to SPEC-04's numeric map). **#4 DONE; only #2 (operator endpoint edges) remains deferred.**
- 2026-09-16 — **SPEC-01 Node reshape DONE** on `todl_20` (TDD + compiler-driven sweep, +9 reshape tests, full suite **835 green**, typecheck-clean). The big surgery: `Node.typeOf` → **`type`** (instance concept, instance tier) + **`metaKind`** (ontology construct, ontology tier); root fields **`namespace`/`localId`/`isClass`/`class`/`storageId`** added; **`attrs` is now user-data-only**. Store dual-indexes: `byType` keys on `type`, new `byMetaKind` (+ `Graph.nodesOfMetaKind`/`Repository.nodesOfMetaKind`) keys on `metaKind` — every old `instancesOf(<meta-kind sentinel>)` caller (js-module, manifest emitter, `viewpoints()`) moved to `nodesOfMetaKind`. `Builder.makeNode` factory routes each construction site to the right field; a **taxonomy term** is the one dual node (`type` = its concept **and** `metaKind = Term`, `isClass`, `localId`). Swept ~117 `typeOf` sites across 20 src files; the **38 test files** were migrated by 4 parallel subagents against a written rulebook, then reconciled. **#5 blocklist deleted** (`effectiveFields` clean overlay; `checkOverride` marker skip gone; `entity.ts` `MARKER_ATTRS` removed). **#6 enforced:** new `ContainsTargetNotTerm` diagnostic rejects a taxonomy `Contains` target lacking `metaKind === Term`. **Key design call — record identity → `localId`, not an `id` attr:** the loader stopped staging `id` as an attr; `assertInstance`/`assertModel` set the root `localId`. Evidence it's correct: the prelude's `Element` declares only `label?`/`description?` (no `id` field), so `id` was never a schema field — just identity surfaced into `attrs`. Keeping it there would have made `checkOverride` false-positive a `ClassOverride` (leaf.id ≠ class.id, per-instance by nature); moving it to `localId` makes the deleted blocklist correct with zero special-casing. JSON (`JsonNode`) + Cypher store persist the new root fields; round-trip is identity. **#4 (scalar→attr / ref→edge, drop scalar `HasField`) and #2 (operator endpoint edges) DEFERRED with evidence** (coherence notes #3/#4 updated): `schemaOf` (walking `HasField`) is the SOLE schema source for validation + loader reference-resolution + the manifest emitter, with **no manifest-backed replacement wired** — dropping scalar `HasField` would silently disable scalar validation and strip scalar fields from emitted manifests; the spec's own Open Questions couples #4 to SPEC-02/03. #2's `from`/`to` are member-name strings, not concept refs, so there are no separate endpoints to edge-ify beyond the existing `Targets`. Both are cleanly separable follow-ups; the reshape (the "117 `typeOf` sites" decision) is complete. **SPEC-01 now `implemented`.** Not pushed (awaiting request).
