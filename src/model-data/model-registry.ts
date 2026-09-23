// The model -> loader link: maps a model id to its ModelDataSource. Populated at
// bootstrap; the app reaches a model's data via GetRequired(modelId). PrepareAll
// is the startup fan-out that loads/authenticates every model's data before the
// synchronous read surface goes live.

import type { IServiceProvider } from "@pragmatic-tech-ai/todl-runtime";
import type { NodeId } from "../compiler-services/model/graph.js";
import type { ModelDataSource } from "./model-data-source.js";

export class ModelRegistry
{
    private static readonly UnknownModelMessage = "ModelRegistry: no data source registered for model ";

    private readonly sources = new Map<NodeId, ModelDataSource>();

    public Register(modelId: NodeId, source: ModelDataSource): this
    {
        this.sources.set(modelId, source);
        return this;
    }

    public Get(modelId: NodeId): ModelDataSource | undefined
    {
        return this.sources.get(modelId);
    }

    public GetRequired(modelId: NodeId): ModelDataSource
    {
        const source = this.sources.get(modelId);
        if (source === undefined) throw new Error(ModelRegistry.UnknownModelMessage + modelId);
        return source;
    }

    public Models(): readonly NodeId[]
    {
        return [...this.sources.keys()];
    }

    public async PrepareAll(services: IServiceProvider): Promise<void>
    {
        for (const source of this.sources.values())
        {
            await source.Prepare(services);
        }
    }
}
