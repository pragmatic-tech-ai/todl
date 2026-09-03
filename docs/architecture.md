# TODL Architecture

`@pragmatic-tech-ai/todl` is a compiler and runtime for a typed-object language.
Everything is organized around one idea: **a reflective typed graph** that source
text is loaded into, validated against, and emitted back out of. The whole system
is one pipeline — `load → validate → emit` — with a language server layered on top
for editor tooling.

```
        SOURCE (.todl text)
            │  parse/           lexer → parser → AST
            ▼
        LOADER (parse/loader.ts, 4 passes)  ──uses──▶ resolve/  (name→node law)
            │
            ▼
   ┌────────────────────────┐
   │   MODEL  (the graph)   │◀── stdlib/prelude (implicit base)
   │  Graph → GraphStore    │
   │  Repository (facade)   │
   └────────────────────────┘
            │                          ▲
     validate/  predicate/             │ read projections:
     (semantic checks,                 │  ReactiveNode / Entity / Element
      invariants)                      │
            │                          │
            ▼                          │
   emit/ (json · todl · js-module)  ·  publish/ · codegen/ · authoring/
            │
            ▼
        LANGUAGE-SERVICE (pure, stateless analysis)
            │
            ▼
        LANGUAGE-SERVER (LSP, caching, multi-project, FS)
```

## The core: one graph, many views

The center of gravity is `src/model/graph.ts`. A `Graph` is nodes
(`{id, tier, typeOf, attrs}`) + typed edges (`{kind, via, from, to}`), with a
`Tier` axis (Meta / Ontology / Instance), an `EdgeKind` axis (Contains,
InstanceOf, Subtype, Relationship, …), dual adjacency for O(1) reverse traversal,
and a change-bus `Signal`. Storage sits behind a `GraphStore` seam
(`src/model/graph-store.ts`) with two implementations: `InMemoryGraphStore` and
`CypherGraphStore` (graph-DB backed).

On top of `Graph` sits `Repository` (`src/model/model.ts`) — the public runtime
facade. It adds the semantic queries the raw graph doesn't have (`subtypesOf`,
`narrowerOf`, `effectiveSchema`, `instancesOfClass`, derived members, invariants)
and an entity cache. `FrozenRepository` (`src/model/frozen.ts`) is the immutable
variant for compiled artifacts.

The one thing worth internalizing: **a node can be looked at three different
ways**, and this is the single biggest source of the "same thing, different
class" feeling:

- `ReactiveNode` (`src/model/reactive.ts`) — an INPC/observable view for live UIs.
- `Entity`/`EntityBase` (`src/model/entity.ts`) — a lazy navigation lens
  (`field`, `ref`, `refs`, `referrers`).
- `Element` (`src/model/element.ts`) — a JSON-serializable deep projection for
  API clients.

## Parse → graph

`src/parse/` is a hand-written lexer + recursive-descent parser producing an AST
(`ast.ts`), plus a separate `predicate-parser.ts` for invariant expressions.
`references.ts` is a single unified AST walk that emits every symbol reference
with its role and a rewrite hook.

`loader.ts` is the heart — and at **1221 lines it's by far the largest and most
redundant file in the codebase**. It runs a four-pass load (namespace resolution
→ type-directed value classification → instance materialization →
operators/invariants) that turns AST into graph nodes and edges.

Name resolution is deliberately centralized in `src/resolve/resolver.ts` — "the
single name→node resolution law," shared by the loader and validator so
namespace-visibility logic lives in exactly one place. That's a good pattern; the
loader is where it isn't followed.

## Validate, predicate, stdlib

`src/validate/validate.ts` (one big `validate(model)` dispatch, 519 lines) runs
all semantic checks over the loaded graph. `src/predicate/` is a small
self-contained sub-language: an expression AST, an evaluator, and
`Invariants`/derivations. `src/stdlib/prelude.ts` is the implicit base library
(`identifier`, `icon`, `element`, standard annotations) injected into every
compile.

## Emit, publish, codegen

Three emitters, each a legitimately different output format: `emit/json.ts`
(interchange `TodlDocument`), `emit/todl.ts` (round-trippable source),
`emit/js-module.ts` (runtime ES-module with Observable classes). `publish/`
compiles + packages against bases with a `PackageStore` seam (blob vs. graph).
`codegen/read-client.ts` generates typed TS clients, `authoring/` is the mutable
draft/file-store overlay, `migrate/` is one-off legacy rewriters.

## Language service & server

`src/language-service/` is **pure and stateless**: `analyze(sources)` rebuilds
everything from scratch, and each editor feature (hover, completion, rename,
semantic-tokens, folding, …) is one small function over that `Analysis`.
`src/language-server/` wraps it with the stateful concerns: LSP wiring, caching,
200ms debounce, multi-project registry, and filesystem discovery. Clean
separation — the server owns state and I/O, the service owns logic.

---

# Redundancy — honest verdict

The apparent redundancy splits into two very different piles. Most of what *looks*
redundant is deliberate layering; a smaller set is genuine duplication worth
removing.

## Deliberate — leave it alone

- **`Repository` delegating to `Graph`** (`related`, `closure`, `allNodes`): a
  facade, not duplication. The graph is the mechanism; the repository is the
  vocabulary.
- **`Graph` vs `GraphStore`**: intentional storage seam so the same graph runs
  in-memory or against Cypher.
- **`Repository` vs `FrozenRepository`**, **Blob vs Graph package stores**, **the
  three emitters**: real polymorphism / distinct outputs, not copies.
- **Dual `_in`/`_out` adjacency**: a performance index.

## Genuine duplication — worth fixing, in priority order

1. **`loader.ts` internals (highest impact).** One file concentrates most of the
   real redundancy: field-binding done three ways (`bindToField` →
   `bindEntityToField` + inline copies in `realizeEdgeValue`/`realizeInlineObject`);
   operator-lookup + its two diagnostics duplicated between `applyEdge` and
   `realizeEdgeValue`; "is this member a reference?" implemented twice
   (`isReferenceMember` vs inline `isReferenceMemberName`); and 70+ hand-inlined
   `diagnostics.push({...})` blocks that beg for one `addDiagnostic()` helper.
   This is where the "lots of functions doing +- the same thing" feeling actually
   comes from.

2. **`ConceptSchema` vs `ElementSchema`** — two near-identical schema shapes
   (`model.ts` vs `element.ts`), the second existing only because `toElement`
   serializes to a POJO. A schema change means editing both. The cleanest single
   fix in the model layer: have `Element` reuse `ConceptSchema` (or a shared
   base).

3. **Three case-conversion implementations** — `pascalCase`/`camelCase` in
   `codegen/naming.ts` and `emit/js-module.ts`, plus `toPascal`/`toCamel` in
   `migrate/recase.ts`, all with the same word-splitting regex. Pick `naming.ts`
   as canonical, re-export from the others.

4. **Duplicated parser cursor primitives** — `current`/`check`/`match`/`advance`/
   `expect`/`checkKeyword` copied between `parse/parser.ts` and
   `parse/predicate-parser.ts`. Extract a shared `TokenCursor` base.

5. **Language-service token/position scanning** — `classifier.ts` and
   `schema-context.ts` each independently walk the token stream to answer "token
   at position / walk backward" (`tokenIndexAt` vs `cursorIndex`), a trivial
   `contains(range,pos)` is copy-pasted in `reference-index.ts` and
   `definitions.ts`, and the "occurrence-then-definition, with pos-1 edge
   tolerance" resolution is repeated in `navigation.ts` and `rename.ts`. A small
   `token-utils.ts` + one `resolveSymbol()` collapses all of it.

If refactoring effort should go where it actually moves the needle, it's **#1
(loader) and #2 (schema types)** — the rest is cheap cleanup. The architecture
itself is sound; the redundancy is localized, not structural.
