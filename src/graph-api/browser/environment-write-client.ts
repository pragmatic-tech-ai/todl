// Write seam onto a live environment. Declared in the engine in engine-only terms
// (the connector write-op types); the transport adapter above the engine
// implements it. Carries no protocol types.

import type { ConnectorWriteOp, ConnectorWriteResult } from "../../model-data/connector-write-op.js";

export interface IEnvironmentWriteClient
{
    WriteDocument(ops: readonly ConnectorWriteOp[]): Promise<ConnectorWriteResult>;
}
