import { toJSON } from "../compiler-services/emit/json.js";
import { FrozenGraph } from "../domain/graph.js";
import { GraphQuery } from "../graph-api/graph-query-engine.js";
import { Manifest } from "../manifest/reflection/reflection.js";
import { PackageManifestBridge } from "../solution-services/package-manager/package-manifest-bridge.js";
import { GraphQueryAdapter, type ICypherGraph } from "../cypher/graph.js";
import type { ModelDraft } from "./model-draft.js";

export interface ModelDraftBakeOptions
{
    model?: string;
    version?: string;
}

/**
 * Synchronously re-bakes a {@link ModelDraft} into a read-only Cypher graph: the draft's full
 * document (bases plus own delta) is lowered to a manifest, reflected into a frozen graph and
 * wrapped for Cypher. Suitable as the `bake` seam of `ModelDraftWriter`.
 */
export class ModelDraftBaker
{
    private static readonly DefaultVersion = "0.0.0";

    public static Bake(draft: ModelDraft, opts?: ModelDraftBakeOptions): ICypherGraph
    {
        const model = opts?.model ?? draft.namespace;
        const version = opts?.version ?? ModelDraftBaker.DefaultVersion;
        const resolved = PackageManifestBridge.toResolvedJsonDocument(toJSON(draft.model), model, version, []);
        const manifest = Manifest.load(resolved.manifest);
        const graph = new FrozenGraph();
        graph.PreRegister(manifest);
        graph.Finalize(manifest);
        if (resolved.seed !== undefined) graph.BindSeed(resolved.seed, { model, version });
        return new GraphQueryAdapter(new GraphQuery(graph));
    }
}
