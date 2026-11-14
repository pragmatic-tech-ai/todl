// A model-data connector for a deployed "remote" app: the data is read live from
// the environment instead of being embedded in the build. The engine does not know how
// the environment is reached; it depends only on the IEnvironmentReadClient seam declared
// here. The transport adapter lives above the engine and implements this seam.

import type { IServiceProvider } from "@pragmatic-tech-ai/todl-runtime";
import type { TodlDocument } from "../../compiler-services/emit/json.js";
import type { IModelDataConnector } from "../../model-data/model-data-connector.js";
import type { ConnectorWriteOp, ConnectorWriteResult } from "../../model-data/connector-write-op.js";
import type { IEnvironmentWriteClient } from "./environment-write-client.js";

/**
 * Minimal read seam onto a live environment. The row type is TodlDocument: it is what
 * IModelDataConnector.Prepare must return, so the adapter (not the engine) owns
 * turning environment query results into the portable document.
 */
export interface IEnvironmentReadClient
{
    ReadDocument(): Promise<TodlDocument>;
}

/** Thrown by any write attempt against a read-only remote environment connector. */
export class RemoteWriteUnsupportedError extends Error
{
    private static readonly ErrorName = "RemoteWriteUnsupportedError";
    private static readonly DefaultMessage = "Remote environment connector is read-only; writes arrive in SP1";

    constructor(message: string = RemoteWriteUnsupportedError.DefaultMessage)
    {
        super(message);
        this.name = RemoteWriteUnsupportedError.ErrorName;
    }
}

/**
 * Thrown by an IEnvironmentReadClient when the environment could not read the app's data because one of its data sources did
 * not answer. DataSource is the source's qualified TODL name (`<namespace>.<name>`); the cause stays on the server.
 */
export class RemoteDataSourceUnavailableError extends Error
{
    private static readonly ErrorName = "RemoteDataSourceUnavailableError";
    private static readonly MessageStart = "Data source unavailable: ";

    constructor(public readonly DataSource: string)
    {
        super(RemoteDataSourceUnavailableError.MessageStart + DataSource);
        this.name = RemoteDataSourceUnavailableError.ErrorName;
    }
}

/**
 * Thrown by an IEnvironmentReadClient / IEnvironmentWriteClient when the environment refused the connection because the
 * person has no session (never signed in, or the sign-in expired). Reloading the page lets the environment send them to
 * its sign-in page.
 */
export class RemoteSignInRequiredError extends Error
{
    private static readonly ErrorName = "RemoteSignInRequiredError";
    private static readonly DefaultMessage = "Sign-in required";

    constructor()
    {
        super(RemoteSignInRequiredError.DefaultMessage);
        this.name = RemoteSignInRequiredError.ErrorName;
    }
}

export class RemoteEnvironmentConnector implements IModelDataConnector
{
    private cached: Promise<TodlDocument> | undefined;

    constructor(
        private readonly client: IEnvironmentReadClient,
        private readonly writeClient?: IEnvironmentWriteClient,
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
