// Browser-safe builder of a ModelRegistry from an inlined { shards, root } payload — the
// untyped sibling of the generated AppRegistry.Create(). One GenericModelDataSource per
// shard behind a BundledModelDataConnector; the designated root is marked. `resources`
// (if present) is carried by the page for a future richer view and is ignored here.

import type { TodlDocument } from "../compiler-services/emit/json.js";
import { ModelRegistry } from "./model-registry.js";
import { BundledModelDataConnector } from "./bundled-model-data-connector.js";
import { GenericModelDataSource } from "./generic-model-data-source.js";

export interface BundledAppPayload
{
    shards: Record<string, TodlDocument>;
    root: string;
    resources?: { uri: string; base64: string }[];
}

export class BundledModelRegistry
{
    public static From(payload: BundledAppPayload): ModelRegistry
    {
        const registry = new ModelRegistry();
        for (const [modelId, doc] of Object.entries(payload.shards))
        {
            registry.Register(modelId, new GenericModelDataSource(modelId, new BundledModelDataConnector(doc)));
        }
        registry.SetRoot(payload.root);
        return registry;
    }
}
