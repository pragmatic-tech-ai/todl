// Back-compat façade: the former single-package reflection client, now a thin
// subclass of ModelDataSource that preserves the legacy synchronous
// load(doc, model, version) entry point. New generated code targets
// ModelDataSource directly.

import type { TodlDocument } from "../compiler-services/emit/json.js";
import { ModelDataSource } from "../model-data/model-data-source.js";

export class ReflectedRepository extends ModelDataSource
{
    /** Legacy synchronous load: pins model/version, then materializes. */
    protected load(doc: TodlDocument, model: string, version: string): void
    {
        this.modelName = model;
        this.modelVersion = version;
        this.loadDocument(doc);
    }
}
