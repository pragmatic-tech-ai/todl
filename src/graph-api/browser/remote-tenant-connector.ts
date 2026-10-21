// A model-data connector for a deployed "remote" app: the data is read live from
// the tenant instead of being embedded in the build. The engine does not know how
// the tenant is reached; it depends only on the ITenantReadClient seam declared
// here. The transport adapter lives above the engine and implements this seam.

import type { IServiceProvider } from "@pragmatic-tech-ai/todl-runtime";
import type { TodlDocument } from "../../compiler-services/emit/json.js";
import type { IModelDataConnector } from "../../model-data/model-data-connector.js";
import type { ConnectorWriteOp, ConnectorWriteResult } from "../../model-data/connector-write-op.js";
import type { ITenantWriteClient } from "./tenant-write-client.js";

/**
 * Minimal read seam onto a live tenant. The row type is TodlDocument: it is what
 * IModelDataConnector.Prepare must return, so the adapter (not the engine) owns
 * turning tenant query results into the portable document.
 */
export interface ITenantReadClient
{
    ReadDocument(): Promise<TodlDocument>;
}

/** Thrown by any write attempt against a read-only remote tenant connector. */
export class RemoteWriteUnsupportedError extends Error
{
    private static readonly ErrorName = "RemoteWriteUnsupportedError";
    private static readonly DefaultMessage = "Remote tenant connector is read-only; writes arrive in SP1";

    constructor(message: string = RemoteWriteUnsupportedError.DefaultMessage)
    {
        super(message);
        this.name = RemoteWriteUnsupportedError.ErrorName;
    }
}

export class RemoteTenantConnector implements IModelDataConnector
{
    private cached: Promise<TodlDocument> | undefined;

    constructor(
        private readonly client: ITenantReadClient,
        private readonly writeClient?: ITenantWriteClient,
    )
    {
    }

    public Prepare(services: IServiceProvider): Promise<TodlDocument>
    {
        if (!this.cached)
        {
            const pending = this.client.ReadDocument();
            // Reset on failure so a later Prepare can retry.
            pending.catch(() => { if (this.cached === pending) this.cached = undefined; });
            this.cached = pending;
        }
        return this.cached;
    }

    public Refresh(services: IServiceProvider): Promise<TodlDocument>
    {
        this.cached = undefined;
        return this.Prepare(services);
    }

    /** Forwards writes to the write client; throws when none was supplied (read-only). */
    public async Apply(ops: readonly ConnectorWriteOp[]): Promise<ConnectorWriteResult>
    {
        if (!this.writeClient)
        {
            throw new RemoteWriteUnsupportedError();
        }
        return this.writeClient.WriteDocument(ops);
    }
}
