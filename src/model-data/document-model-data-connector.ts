// The document-backed connector: a model's document is already in memory
// (the read-client / fromJSON case). Prepare simply hands it back — no I/O,
// no auth, no configuration.

import type { IServiceProvider } from "@pragmatic-tech-ai/todl-runtime";
import type { TodlDocument } from "../compiler-services/emit/json.js";
import type { IModelDataConnector } from "./model-data-connector.js";

export class DocumentModelDataConnector implements IModelDataConnector
{
    constructor(private readonly document: TodlDocument)
    {
    }

    public Prepare(_services: IServiceProvider): Promise<TodlDocument>
    {
        return Promise.resolve(this.document);
    }
}
