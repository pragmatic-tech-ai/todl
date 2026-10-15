import type { IServiceProvider } from "@pragmatic-tech-ai/todl-runtime";
import type { DataSourceAdapterCatalog } from "./data-source-adapter-catalog.js";
import type { IDataSourceAdapter } from "./data-source-adapter.js";
import type { ModelConnectorPlan, ConnectorBinding, ConnectorSpec, QueryRequest } from "./connector-plan.js";
import type { ReflectedNode, InstanceMirror } from "../manifest/reflection/reflection.js";
import { ConnectorMirrorMapper } from "./connector-mirror-mapper.js";

/** Turns a minted node into a live reflection handle (the manifest-bound factory). */
export interface INodeReflector
{
    reflect(node: ReflectedNode): InstanceMirror;
}

/** Async pre-fetch of connector rows into reflectable mirrors, so the query itself can stay synchronous. */
export class ConnectorPrefetch
{
    public static async ForConcepts(
        concepts: Iterable<string>,
        plan: ModelConnectorPlan,
        catalog: DataSourceAdapterCatalog,
        services: IServiceProvider,
        reflector: INodeReflector): Promise<Map<string, InstanceMirror[]>>
    {
        const snapshot = new Map<string, InstanceMirror[]>();
        for (const concept of concepts)
        {
            if (snapshot.has(concept))
            {
                continue;
            }
            // One binding per concept is assumed: the first match wins; multiple bindings for one concept are unsupported here.
            const binding = plan.Bindings.find(b => b.Concept === concept);
            const spec = binding === undefined ? undefined : plan.Connectors.find(c => c.Name === binding.Connector);
            if (binding === undefined || spec === undefined)
            {
                continue;
            }
            snapshot.set(concept, await ConnectorPrefetch.Fetch(binding, spec, catalog, services, reflector));
        }
        return snapshot;
    }

    private static async Fetch(
        binding: ConnectorBinding,
        spec: ConnectorSpec,
        catalog: DataSourceAdapterCatalog,
        services: IServiceProvider,
        reflector: INodeReflector): Promise<InstanceMirror[]>
    {
        let adapter: IDataSourceAdapter;
        try
        {
            adapter = await catalog.Open(spec, services);
        }
        catch
        {
            return [];   // fail-closed: an unresolved adapter yields no instances, not a query error
        }
        const request: QueryRequest = { Source: binding.Source, Fields: [...new Set(Object.values(binding.FieldMap))].sort() };
        const records = await adapter.Query(request);   // a resolved-but-failing adapter's error propagates (loud, not silent-empty)
        const mirrors: InstanceMirror[] = [];
        for (const record of records)
        {
            const node = ConnectorMirrorMapper.NodeFor(binding, record);
            if (node !== undefined)
            {
                mirrors.push(reflector.reflect(node));
            }
        }
        return mirrors;
    }
}
