import type { IServiceProvider } from "@pragmatic-tech-ai/todl-runtime";
import type { JsonNode, TodlDocument } from "../compiler-services/emit/json.js";
import type { ConnectorBinding, ExternalFieldValue, ModelConnectorPlan, WriteBatch, WriteOperation, WriteResult } from "./connector-plan.js";
import { ConnectorLookup, WriteOperationKind } from "./connector-plan.js";
import type { DataSourceAdapterCatalog } from "./data-source-adapter-catalog.js";

/** Tracks edits to populated instances and flushes them to the owning adapters (last-write-wins upsert). */
export class ConnectorWorkingCopy
{

    private readonly bindings = new Map<string, ConnectorBinding>();
    private readonly nodes = new Map<string, JsonNode>();
    private readonly pending = new Map<string, WriteOperationKind>();
    private readonly rejected = new Set<string>();

    public constructor(private readonly plan: ModelConnectorPlan, document: TodlDocument)
    {
        for (const binding of plan.Bindings) this.bindings.set(binding.Concept, binding);
        for (const node of document.nodes) this.nodes.set(node.id, node);
    }

    public MarkDirty(instanceId: string): void
    {
        this.Record(instanceId, WriteOperationKind.Upsert);
    }

    public MarkDeleted(instanceId: string): void
    {
        this.Record(instanceId, WriteOperationKind.Delete);
    }

    public async Flush(catalog: DataSourceAdapterCatalog, services: IServiceProvider): Promise<readonly WriteResult[]>
    {
        const groups = new Map<ConnectorBinding, string[]>();
        for (const instanceId of this.pending.keys())
        {
            const binding = this.BindingOf(instanceId);
            if (!binding || !binding.Writable) continue;
            // Writing brand-new instances without a source key (insert-with-generated-key) is a v1 limitation / follow-on.
            if (this.nodes.get(instanceId)!.storageId == null) continue;
            const group = groups.get(binding) ?? [];
            group.push(instanceId);
            groups.set(binding, group);
        }

        const results: WriteResult[] = [];
        for (const [binding, instanceIds] of groups)
        {
            const operations = instanceIds.map(instanceId => this.OperationFor(binding, instanceId));
            const batch: WriteBatch = { Source: binding.Source, IdKey: binding.IdKey, Operations: operations };
            const adapter = await catalog.Open(ConnectorLookup.Find(this.plan.Connectors, binding), services);
            const result = await adapter.Apply(batch);
            results.push(result);
            const conflicted = new Set<ExternalFieldValue>(result.Conflicts.map(conflict => conflict.Key));
            instanceIds.forEach((instanceId, index) =>
            {
                if (!conflicted.has(operations[index]!.Key)) this.pending.delete(instanceId);
            });
        }
        return results;
    }

    private Record(instanceId: string, kind: WriteOperationKind): void
    {
        const binding = this.BindingOf(instanceId);
        if (!binding) return;
        if (!binding.Writable)
        {
            // Task 5 turns this into a connector.read-only diagnostic.
            this.rejected.add(instanceId);
            return;
        }
        this.pending.set(instanceId, kind);
    }

    private BindingOf(instanceId: string): ConnectorBinding | undefined
    {
        const node = this.nodes.get(instanceId);
        return node?.type ? this.bindings.get(node.type) : undefined;
    }

    private OperationFor(binding: ConnectorBinding, instanceId: string): WriteOperation
    {
        const node = this.nodes.get(instanceId)!;
        const kind = this.pending.get(instanceId)!;
        const fields: Record<string, ExternalFieldValue> = {};
        if (kind === WriteOperationKind.Upsert)
        {
            for (const [member, value] of Object.entries(node.attrs))
            {
                const external = binding.FieldMap[member];
                // The id column travels as Key, never as a field (mirrors the read path).
                if (external === undefined || external === binding.IdKey) continue;
                fields[external] = value;
            }
        }
        return { Kind: kind, Key: node.storageId!, Fields: fields };
    }
}
