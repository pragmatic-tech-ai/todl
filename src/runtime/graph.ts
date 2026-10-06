/**
 * The runtime root (design: todl-runtime-surface §4/§8). `TODL.ComposeGraph`
 * composes an assembly's package closure (meta-models + libraries) into one live
 * schema `Graph`; `TODL.Load` populates its models from a `ModelSource`. The
 * `Graph` is a façade over a {@link Repository} (the internal engine) — composition
 * reuses the same first-wins `mergeBases` dedup the compiler uses.
 */
import { mergeBases } from "../compiler-services/api.js";
import { preludeDocument } from "../compiler-services/stdlib/prelude.js";
import { Repository } from "../compiler-services/model/model.js";
import { MetaKind } from "../compiler-services/model/kinds.js";
import type { NodeId } from "../compiler-services/model/graph.js";
import type { TodlDocument } from "../compiler-services/emit/json.js";
import type { ModelSource } from "./source.js";
import { Model, TodlDefinition } from "./handles.js";

/** A composed, optionally-populated runtime model: schema (definitions) from the
 *  assembly's packages, data (models/instances) from loaded sources. */
export class Graph
{
  /** Every document merged so far — the base packages plus any loaded sources.
   *  Composition is a pure fold, so a load just appends and rebuilds. */
  private readonly documents: TodlDocument[];
  private repository: Repository;

  constructor(metaModels: readonly TodlDocument[], libraries: readonly TodlDocument[])
  {
    this.documents = [...metaModels, ...libraries];
    this.repository = this.compose();
  }

  private compose(): Repository
  {
    return new Repository(mergeBases([preludeDocument(), ...this.documents]));
  }

  /** Merge a source's instances into the graph (populating the model shells). */
  async Load(source: ModelSource): Promise<void>
  {
    this.documents.push(await source.Load());
    this.repository = this.compose();
  }

  /** The models known to this graph. */
  get Models(): Model[]
  {
    return this.repository
      .allNodes()
      .filter((node) => node.metaKind === MetaKind.Model)
      .map((node) => new Model(this.repository, node.id));
  }

  /** Resolve a concept definition by its qualified node id (`tech_architecture.Location`).
   *  Node ids are namespace-qualified, so this is a direct lookup. Returns undefined
   *  when no such concept exists. */
  GetDefinition(qualifiedId: string): TodlDefinition | undefined
  {
    if (!this.repository.has(qualifiedId)) return undefined;
    return this.repository.resolve(qualifiedId)?.metaKind === MetaKind.Concept
      ? new TodlDefinition(this.repository, qualifiedId)
      : undefined;
  }
}

/** The static entry point (design: todl-runtime-surface §4). */
export const TODL = {
  /** Compose an assembly's meta-models + libraries into a runtime schema graph. */
  ComposeGraph(metaModels: readonly TodlDocument[], libraries: readonly TodlDocument[]): Graph
  {
    return new Graph(metaModels, libraries);
  },

  /** Populate a graph's models from a source (async: sources may be I/O-backed). */
  Load(graph: Graph, source: ModelSource): Promise<void>
  {
    return graph.Load(source);
  },
};
