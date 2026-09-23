// The bundled connector: a model's document was embedded into the build artifact.
// Prepare returns it directly — no I/O, no auth, no configuration. Distinct in
// role from DocumentModelDataConnector (a document handed in at runtime); this
// one owns a build-time-embedded shard.

import type { IServiceProvider } from "@pragmatic-tech-ai/todl-runtime";
import type { TodlDocument } from "../compiler-services/emit/json.js";
import type { IModelDataConnector } from "./model-data-connector.js";

export class BundledModelDataConnector implements IModelDataConnector
{
    constructor(private readonly shard: TodlDocument)
    {
    }

    public Prepare(_services: IServiceProvider): Promise<TodlDocument>
    {
        return Promise.resolve(this.shard);
    }
}
