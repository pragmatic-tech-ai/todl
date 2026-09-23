// The backing seam beneath a ModelDataSource: authenticate (if needed) and
// return this model's instances as a portable TodlDocument. Called once at
// application startup, before any synchronous accessor is used.

import type { IServiceProvider } from "@pragmatic-tech-ai/todl-runtime";
import type { TodlDocument } from "../compiler-services/emit/json.js";

export interface IModelDataConnector
{
    /**
     * Load this model's document. May authenticate and fetch, resolving
     * configuration and credentials from `services`. Idempotent by contract:
     * a second call after success should return the same document.
     */
    Prepare(services: IServiceProvider): Promise<TodlDocument>;
}
