import type { IServiceProvider } from "@pragmatic-tech-ai/todl-runtime";
import type { TodlDocument } from "../compiler-services/emit/json.js";
import type { ConnectorBinding, ConnectorSpec, ModelConnectorPlan, QueryRequest } from "./connector-plan.js";
import { ConnectorWorkingCopy } from "./connector-working-copy.js";
import { DataSourceAdapterCatalog } from "./data-source-adapter-catalog.js";
import type { IModelDataConnector } from "./model-data-connector.js";
import { PopulationBuilder } from "./population-builder.js";

/** Read path: pulls each bound population from its external source and merges it over the hand-authored shard. */
export class FederatedModelDataConnector implements IModelDataConnector
{
    private static readonly UnknownConnectorPrefix = "binding for '";
    private static readonly UnknownConnectorMiddle = "' references unknown connector '";
    private static readonly UnknownConnectorSuffix = "'";

    private static readonly NotPreparedMessage = "WorkingCopy requires Prepare to have completed";

    private pending: Promise<TodlDocument> | undefined;
    private built: TodlDocument | undefined;
    private workingCopy: ConnectorWorkingCopy | undefined;

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
            const spec = this.FindSpec(binding);
            const adapter = await catalog.Open(spec, services);
            const records = await adapter.Query(FederatedModelDataConnector.RequestFor(binding));
            builder.Add(binding, records);
        }
        this.built = builder.Build();
        return this.built;
    }

    /** Lazily creates the write-back working copy over the built document; requires a completed Prepare. */
    public WorkingCopy(): ConnectorWorkingCopy
    {
        if (!this.built) throw new Error(FederatedModelDataConnector.NotPreparedMessage);
        this.workingCopy ??= new ConnectorWorkingCopy(this.plan, this.built);
        return this.workingCopy;
    }

    private FindSpec(binding: ConnectorBinding): ConnectorSpec
    {
        const spec = this.plan.Connectors.find(candidate => candidate.Name === binding.Connector);
        if (!spec)
        {
            throw new Error(`${FederatedModelDataConnector.UnknownConnectorPrefix}${binding.Concept}`
                + `${FederatedModelDataConnector.UnknownConnectorMiddle}${binding.Connector}`
                + FederatedModelDataConnector.UnknownConnectorSuffix);
        }
        return spec;
    }

    private static RequestFor(binding: ConnectorBinding): QueryRequest
    {
        const fields = [...new Set(Object.values(binding.FieldMap))].sort();
        return { Source: binding.Source, Fields: fields };
    }
}
