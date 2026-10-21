// Write seam onto a live tenant. Declared in the engine in engine-only terms
// (the connector write-op types); the transport adapter above the engine
// implements it. Carries no protocol types.

import type { ConnectorWriteOp, ConnectorWriteResult } from "../../model-data/connector-write-op.js";

export interface ITenantWriteClient
{
    WriteDocument(ops: readonly ConnectorWriteOp[]): Promise<ConnectorWriteResult>;
}
