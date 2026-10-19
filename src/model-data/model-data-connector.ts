// The backing seam beneath a ModelDataSource: authenticate (if needed) and
// return this model's instances as a portable TodlDocument. Called once at
// application startup, before any synchronous accessor is used.

import type { IServiceProvider } from "@pragmatic-tech-ai/todl-runtime";
import type { TodlDocument } from "../compiler-services/emit/json.js";
import type { ConnectorWriteOp, ConnectorWriteResult } from "./connector-write-op.js";

export interface IModelDataConnector
{
    /**
     * Load this model's document. May authenticate and fetch, resolving
     * configuration and credentials from `services`. Idempotent by contract:
     * a second call after success should return the same document.
     */
    Prepare(services: IServiceProvider): Promise<TodlDocument>;

    /** Optional in-place re-pull. Absent on connectors that cannot refresh (the source reports not-refreshable). */
    Refresh?(services: IServiceProvider): Promise<TodlDocument>;

    /** Optional write path: apply a batch of create / update / delete ops. Absent on read-only connectors (the source reports write-unsupported). */
    Apply?(ops: readonly ConnectorWriteOp[]): Promise<ConnectorWriteResult>;
}
