import { loadInto } from "./parse/loader.js";
import { type IdGenerator, SnowflakeIdGenerator } from "./model/id-generator.js";
import { validate } from "./validate/validate.js";
import { Graph, Tier, EdgeKind } from "./model/graph.js";
import { Repository } from "./model/model.js";
import type { TodlDocument } from "./emit/json.js";
import type { SourceFile } from "./diagnostics/span.js";
import type { Diagnostic } from "./diagnostics/diagnostic.js";
import { preludeDocument, preludeNames } from "./stdlib/prelude.js";

/**
 * Load the sources and validate the result; every diagnostic is spanned. The
 * default library (prelude) is injected as the implicit foundation base, so
 * standard names (`identifier`, `icon`, `element`, …) resolve everywhere.
 *
 * @example A self-contained tech-architecture model (meta-model + instances in one
 * source). `check` compiles it and returns the populated graph plus diagnostics.
 * ```ts
 * const { model, diagnostics } = check([{
 *   uri: "landscape.todl",
 *   text: `
 *     namespace acme.ea {
 *       // The meta-model: what a Component is.
 *       concept Component { name : string; calls : Component?; }
 *
 *       // The model: concrete components wired together. \`calls = api\` becomes a
 *       // Relationship edge because \`calls\` is a Component-typed (reference) member;
 *       // \`api\` may be referenced before it is declared.
 *       model Landscape : acme.ea {
 *         Component web { name = "Web"; calls = api; }
 *         Component api { name = "API"; }
 *       }
 *     }`,
 * }]);
 *
 * diagnostics;                        // []  — compiles clean
 * model.instancesOf("Component");     // ["web", "api"]
 * ```
 */
export function check(sources: SourceFile[], idGenerator?: IdGenerator): { model: Repository; diagnostics: Diagnostic[]; provenance: Map<string, string> }
{
  return checkAgainst([], sources, idGenerator);
}

/**
 * Load + validate `sources` against already-compiled base models (published
 * meta-models / libraries, as TodlDocument JSON). Bases seed the graph so a
 * source reference resolves to a base node instead of being reported undefined.
 * `checkAgainst([], sources)` is equivalent to `check(sources)`.
 *
 * @example Split the architecture across a published meta-model and a downstream
 * model — the real deployment shape. The meta-model is compiled once to a
 * `TodlDocument`; the model is then checked against it, and `acme.ea.Component`
 * resolves to the base node rather than being reported undefined.
 * ```ts
 * // 1. The meta-model, compiled to a portable document (e.g. a published package).
 * const eaBase = toJSON(check([{
 *   uri: "ea.todl",
 *   text: `namespace acme.ea { concept Component { name : string; calls : Component?; } }`,
 * }]).model);
 *
 * // 2. A downstream model compiled AGAINST that base.
 * const { model, diagnostics } = checkAgainst([eaBase], [{
 *   uri: "landscape.todl",
 *   text: `
 *     namespace acme.app {
 *       model Landscape : acme.ea {
 *         acme.ea.Component web { name = "Web"; calls = api; }
 *         acme.ea.Component api { name = "API"; }
 *       }
 *     }`,
 * }]);
 *
 * diagnostics;                     // []  — the base node satisfies the reference
 * model.instancesOf("Component");   // ["web", "api"]  (node ids are flat)
 * ```
 */
export function checkAgainst(
  bases: TodlDocument[],
  sources: SourceFile[],
  idGenerator: IdGenerator = new SnowflakeIdGenerator(),
): { model: Repository; diagnostics: Diagnostic[]; provenance: Map<string, string> }
{
  const model = new Repository(mergeBases([preludeDocument(), ...bases]));
  const provenance = new Map<string, string>();
  const diagnostics = loadInto(model, sources, preludeNames(), idGenerator, provenance);
  return { model, diagnostics: [...diagnostics, ...validate(model)], provenance };
}

/**
 * Deserialize base documents into one graph with idempotent first-wins dedup:
 * a node id already present is kept (first base wins); an edge identical to one
 * already present (kind + via + from + to) is dropped — so bases sharing a
 * foundation (a library carrying its meta-model) compose without duplicate nodes
 * or double-counted edges. All nodes are added before any edges, since an edge
 * requires both endpoints to exist.
 *
 * @example Seed one graph from the prelude plus a compiled architecture base —
 * exactly what `checkAgainst` does internally before loading sources. Because the
 * base itself was compiled with the prelude, the shared prelude nodes collapse to
 * one copy (first-wins), rather than being duplicated.
 * ```ts
 * const eaBase = toJSON(check([{
 *   uri: "ea.todl",
 *   text: `namespace acme.ea { concept Component { name : string; } }`,
 * }]).model);
 *
 * const seed = mergeBases([preludeDocument(), eaBase]);
 * const model = new Repository(seed); // ready to load downstream sources into
 * ```
 */
export function mergeBases(bases: TodlDocument[]): Graph
{
  const graph = new Graph();
  for (const base of bases)
  {
    for (const node of base.nodes)
    {
      if (graph.hasNode(node.id)) continue;
      graph.addNode({
        id: node.id,
        tier: Tier[node.tier as keyof typeof Tier],
        type: node.type ?? null,
        metaKind: node.metaKind ?? null,
        namespace: node.namespace ?? null,
        localId: node.localId ?? null,
        isClass: node.isClass ?? false,
        class: node.class ?? null,
        storageId: node.storageId ?? null,
        fields: node.fields ?? [],
        attrs: new Map(Object.entries(node.attrs)),
      });
    }
  }
  for (const base of bases)
  {
    for (const edge of base.edges)
    {
      const kind = EdgeKind[edge.kind as keyof typeof EdgeKind];
      if (hasEdge(graph, kind, edge.via, edge.from, edge.to)) continue;
      graph.addEdge({ kind, via: edge.via, from: edge.from, to: edge.to });
    }
  }
  return graph;
}

/** Is an identical edge (kind + via + from + to) already on the graph? */
function hasEdge(graph: Graph, kind: EdgeKind, via: string | null, from: string, to: string): boolean
{
  for (const e of graph.outEdges(from))
  {
    if (e.kind === kind && e.via === via && e.to === to) return true;
  }
  return false;
}
