import type { IServiceProvider } from "@pragmatic-tech-ai/todl-runtime";
import type { TodlDocument } from "../compiler-services/emit/json.js";
import { ConnectorLookup, type ConnectorBinding, type ModelConnectorPlan, type QueryFilter, type QueryRequest } from "./connector-plan.js";
import { ConnectorWorkingCopy } from "./connector-working-copy.js";
import { DataSourceAdapterCatalog } from "./data-source-adapter-catalog.js";
import type { IModelDataConnector } from "./model-data-connector.js";
import { PopulationBuilder } from "./population-builder.js";
import { ConnectorResolutionStep, type ConnectorResolutionResult } from "./connector-resolution-step.js";
import { ResolutionAuditSinkKey } from "./resolution-audit-sink.js";
import type { MergeDecision } from "../compiler-services/resolution/resolution-pass.js";
import type { Diagnostic } from "../compiler-services/diagnostics/diagnostic.js";

/** Supplies an optional per-concept filter that is pushed into the connector's query. */
export interface IConnectorQueryFilterProvider
{
    WhereFor(concept: string): QueryFilter | undefined;
}

/** Read path: pulls each bound population from its external source and merges it over the hand-authored shard. */
export class FederatedModelDataConnector implements IModelDataConnector
{
    private static readonly NotPreparedMessage = "Prepare must complete before accessing connector results";

    private pending: Promise<TodlDocument> | undefined;
    private built: TodlDocument | undefined;
    private workingCopy: ConnectorWorkingCopy | undefined;
    private queryFilterProvider: IConnectorQueryFilterProvider | undefined;
    private resolution: ConnectorResolutionResult | undefined;
    private lastRefreshDiagnostics: readonly Diagnostic[] = [];

    public constructor(private readonly plan: ModelConnectorPlan, private readonly base: TodlDocument)
    {
    }

    /** Installs (or clears) the per-concept query-filter provider; call before Prepare. */
    public UseQueryFilterProvider(provider: IConnectorQueryFilterProvider | undefined): void
    {
        this.queryFilterProvider = provider;
    }

    public Prepare(services: IServiceProvider): Promise<TodlDocument>
    {
        if (!this.pending)
        {
            this.pending = this.Build(services);
            // Reset the cache on failure so a later Prepare can retry.
            this.pending.catch(() => { this.pending = undefined; });
        }
        return this.pending;
    }

    private async Build(services: IServiceProvider): Promise<TodlDocument>
    {
        const resolution = await this.Materialize(services);
        this.resolution = resolution;
        this.built = resolution.document;
        await this.EmitAudit(services, resolution);
        return this.built;
    }

    /** Pulls every binding and resolves into a NEW document without mutating instance state (may throw). */
    private async Materialize(services: IServiceProvider): Promise<ConnectorResolutionResult>
    {
        const catalog = services.getRequired(DataSourceAdapterCatalog.ServiceKey);
        const builder = new PopulationBuilder(this.base);
        for (const binding of this.plan.Bindings)
        {
            const spec = ConnectorLookup.Find(this.plan.Connectors, binding);
            const adapter = await catalog.Open(spec, services);
            const records = await adapter.Query(this.RequestFor(binding));
            builder.Add(binding, records);
        }
        const built = builder.Build();
        return new ConnectorResolutionStep().Resolve(built, builder.Sources());
    }

    private async EmitAudit(services: IServiceProvider, resolution: ConnectorResolutionResult): Promise<void>
    {
        const auditSink = services.get(ResolutionAuditSinkKey);
        if (auditSink !== undefined && resolution.decisions.length > 0)
        {
            await auditSink.Record({ model: this.plan.Model, decisions: resolution.decisions });
        }
    }

    /** In-place data refresh: re-pull every binding and resolve into a NEW document, then atomically swap
     *  the built document + resolution, rebind the working copy (pruning vanished pending ops), and re-emit
     *  audit. On any query/resolution failure the previous state is left intact and the error rethrows.
     *  Adapters are reused (no catalog eviction). Must not be called before Prepare completes, and is not
     *  safe to call concurrently with an in-flight Prepare (callers serialize). */
    public async Refresh(services: IServiceProvider): Promise<TodlDocument>
    {
        if (!this.built) throw new Error(FederatedModelDataConnector.NotPreparedMessage);
        const resolution = await this.Materialize(services); // may throw - nothing mutated yet
        this.lastRefreshDiagnostics = this.workingCopy === undefined
            ? []
            : this.workingCopy.Rebind(resolution.document, resolution.writeTargets);
        this.resolution = resolution;
        this.built = resolution.document;
        await this.EmitAudit(services, resolution);
        return this.built;
    }

    /** Dropped-pending-op diagnostics from the most recent Refresh (empty if no working copy / none dropped). */
    public LastRefreshDiagnostics(): readonly Diagnostic[]
    {
        return this.lastRefreshDiagnostics;
    }

    /** Lazily creates the write-back working copy over the built document; requires a completed Prepare. */
    public WorkingCopy(): ConnectorWorkingCopy
    {
        if (!this.built) throw new Error(FederatedModelDataConnector.NotPreparedMessage);
        this.workingCopy ??= new ConnectorWorkingCopy(this.plan, this.built, this.resolution!.writeTargets);
        return this.workingCopy;
    }

    public Decisions(): readonly MergeDecision[]
    {
        if (!this.resolution) throw new Error(FederatedModelDataConnector.NotPreparedMessage);
        return this.resolution.decisions;
    }

    public Diagnostics(): readonly Diagnostic[]
    {
        if (!this.resolution) throw new Error(FederatedModelDataConnector.NotPreparedMessage);
        return this.resolution.diagnostics;
    }

    private RequestFor(binding: ConnectorBinding): QueryRequest
    {
        const fields = [...new Set(Object.values(binding.FieldMap))].sort();
        const where = this.queryFilterProvider?.WhereFor(binding.Concept);
        return where === undefined ? { Source: binding.Source, Fields: fields } : { Source: binding.Source, Fields: fields, Where: where };
    }
}
