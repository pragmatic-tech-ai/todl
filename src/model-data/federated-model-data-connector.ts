import type { IServiceProvider } from "@pragmatic-tech-ai/todl-runtime";
import type { TodlDocument } from "../compiler-services/emit/json.js";
import { ConnectorLookup, type ConnectorBinding, type ModelConnectorPlan, type QueryRequest } from "./connector-plan.js";
import { ConnectorWorkingCopy } from "./connector-working-copy.js";
import { DataSourceAdapterCatalog } from "./data-source-adapter-catalog.js";
import type { IModelDataConnector } from "./model-data-connector.js";
import { PopulationBuilder } from "./population-builder.js";
import { ConnectorResolutionStep, type ConnectorResolutionResult } from "./connector-resolution-step.js";
import type { MergeDecision } from "../compiler-services/resolution/resolution-pass.js";
import type { Diagnostic } from "../compiler-services/diagnostics/diagnostic.js";

/** Read path: pulls each bound population from its external source and merges it over the hand-authored shard. */
export class FederatedModelDataConnector implements IModelDataConnector
{
    private static readonly NotPreparedMessage = "WorkingCopy requires Prepare to have completed";

    private pending: Promise<TodlDocument> | undefined;
    private built: TodlDocument | undefined;
    private workingCopy: ConnectorWorkingCopy | undefined;
    private resolution: ConnectorResolutionResult | undefined;

    public constructor(private readonly plan: ModelConnectorPlan, private readonly base: TodlDocument)
    {
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
        const catalog = services.getRequired(DataSourceAdapterCatalog.ServiceKey);
        const builder = new PopulationBuilder(this.base);
        for (const binding of this.plan.Bindings)
        {
            const spec = ConnectorLookup.Find(this.plan.Connectors, binding);
            const adapter = await catalog.Open(spec, services);
            const records = await adapter.Query(FederatedModelDataConnector.RequestFor(binding));
            builder.Add(binding, records);
        }
        const built = builder.Build();
        this.resolution = new ConnectorResolutionStep().Resolve(built, builder.Sources());
        this.built = this.resolution.document;
        return this.built;
    }

    /** Lazily creates the write-back working copy over the built document; requires a completed Prepare. */
    public WorkingCopy(): ConnectorWorkingCopy
    {
        if (!this.built) throw new Error(FederatedModelDataConnector.NotPreparedMessage);
        this.workingCopy ??= new ConnectorWorkingCopy(this.plan, this.built);
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

    private static RequestFor(binding: ConnectorBinding): QueryRequest
    {
        const fields = [...new Set(Object.values(binding.FieldMap))].sort();
        return { Source: binding.Source, Fields: fields };
    }
}
