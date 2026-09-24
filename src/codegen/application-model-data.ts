// Root + per-model-shard extraction for a compiled application Repository, shared by
// the typed package codegen (ModelPackageGenerator) and the html-bundle emit action.
// Strict requires an `entrypoint` designation (published-package semantics); the
// html-bundle path uses WithSoleModelFallback so a single-model architecture with no
// entrypoint still boots.

import { Repository } from "../compiler-services/model/model.js";
import { toJSON, type TodlDocument } from "../compiler-services/emit/json.js";
import type { NodeId } from "../compiler-services/model/graph.js";
import { ApplicationRootResolver } from "../model-data/application-root-resolver.js";
import { ModelShardExtractor } from "../model-data/model-shard-extractor.js";

export interface ApplicationModelShards
{
    root: NodeId;
    shards: ReadonlyMap<NodeId, TodlDocument>;
}

export class ApplicationModelData
{
    private static readonly NoEntrypointMessage =
        "ModelPackageGenerator.Generate requires an application root; the model has no `entrypoint` designation.";
    private static readonly NoRootMessage =
        "no application root: the document has no `entrypoint` designation and is not a single model.";

    public static Strict(repo: Repository): ApplicationModelShards
    {
        const doc = toJSON(repo);
        const root = ApplicationRootResolver.Resolve(doc);
        if (root === undefined)
        {
            throw new Error(ApplicationModelData.NoEntrypointMessage);
        }
        return { root, shards: ApplicationModelData.ShardsOf(doc) };
    }

    public static WithSoleModelFallback(repo: Repository): ApplicationModelShards
    {
        const doc = toJSON(repo);
        const explicit = ApplicationRootResolver.Resolve(doc);
        const models = ModelShardExtractor.ModelsOf(doc);
        const root = explicit ?? (models.length === 1 ? models[0] : undefined);
        if (root === undefined)
        {
            throw new Error(ApplicationModelData.NoRootMessage);
        }
        return { root, shards: ApplicationModelData.ShardsOf(doc) };
    }

    private static ShardsOf(doc: TodlDocument): Map<NodeId, TodlDocument>
    {
        const shards = new Map<NodeId, TodlDocument>();
        for (const modelId of ModelShardExtractor.ModelsOf(doc))
        {
            shards.set(modelId, ModelShardExtractor.Extract(doc, modelId));
        }
        return shards;
    }
}
