import type { IServiceProvider } from "@pragmatic-tech-ai/todl-runtime";
import { DiagnosticCode, Severity, type Diagnostic } from "../compiler-services/diagnostics/diagnostic.js";
import type { JsonNode, TodlDocument } from "../compiler-services/emit/json.js";
import type { ConnectorBinding, ExternalFieldValue, ModelConnectorPlan, WriteBatch, WriteOperation, WriteResult } from "./connector-plan.js";
import { ConnectorLookup, WriteOperationKind } from "./connector-plan.js";
import type { DataSourceAdapterCatalog } from "./data-source-adapter-catalog.js";

export interface FlushOutcome
{
    Results: readonly WriteResult[];
    Diagnostics: readonly Diagnostic[];
}

/** Tracks edits to populated instances and flushes them to the owning adapters (optimistic when the binding has a VersionField, else last-write-wins). */
export class ConnectorWorkingCopy
{
    private static readonly ReadOnlyMessage = "Cannot edit read-only connector binding for";
    private static readonly ConflictMessage = "Write conflict on";

    private readonly bindings = new Map<string, ConnectorBinding>();
    private readonly nodes = new Map<string, JsonNode>();
    private readonly pending = new Map<string, WriteOperationKind>();

    public constructor(private readonly plan: ModelConnectorPlan, document: TodlDocument)
    {
        for (const binding of plan.Bindings) this.bindings.set(binding.Concept, binding);
        for (const node of document.nodes) this.nodes.set(node.id, node);
    }

    /** Records an upsert; returns a connector.read-only diagnostic (and records nothing) if the binding is read-only. */
    public MarkDirty(instanceId: string): Diagnostic | undefined
    {
        return this.Record(instanceId, WriteOperationKind.Upsert);
    }

    /** Records a delete; returns a connector.read-only diagnostic (and records nothing) if the binding is read-only. */
    public MarkDeleted(instanceId: string): Diagnostic | undefined
    {
        return this.Record(instanceId, WriteOperationKind.Delete);
    }

    /** Flushes pending edits; conflicts surface as connector.write-conflict diagnostics and stay pending. */
    public async Flush(catalog: DataSourceAdapterCatalog, services: IServiceProvider): Promise<FlushOutcome>
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
        const diagnostics: Diagnostic[] = [];
        for (const [binding, instanceIds] of groups)
        {
            const operations = instanceIds.map(instanceId => this.OperationFor(binding, instanceId));
            const batch: WriteBatch = binding.VersionField === undefined
                ? { Source: binding.Source, IdKey: binding.IdKey, Operations: operations }
                : { Source: binding.Source, IdKey: binding.IdKey, Operations: operations, VersionField: binding.VersionField };
            const adapter = await catalog.Open(ConnectorLookup.Find(this.plan.Connectors, binding), services);
            const result = await adapter.Apply(batch);
            results.push(result);
            for (const conflict of result.Conflicts)
            {
                diagnostics.push(this.Diag(DiagnosticCode.ConnectorWriteConflict,
                    `${ConnectorWorkingCopy.ConflictMessage} ${binding.Concept} ${String(conflict.Key)}: ${conflict.Reason}`, null));
            }
            const conflicted = new Set<ExternalFieldValue>(result.Conflicts.map(conflict => conflict.Key));
            instanceIds.forEach((instanceId, index) =>
            {
                if (!conflicted.has(operations[index]!.Key)) this.pending.delete(instanceId);
            });
        }
        return { Results: results, Diagnostics: diagnostics };
    }

    private Record(instanceId: string, kind: WriteOperationKind): Diagnostic | undefined
    {
        const binding = this.BindingOf(instanceId);
        if (!binding) return undefined;
        if (!binding.Writable)
        {
            return this.Diag(DiagnosticCode.ConnectorReadOnly,
                `${ConnectorWorkingCopy.ReadOnlyMessage} ${binding.Concept} (${instanceId})`, instanceId);
        }
        this.pending.set(instanceId, kind);
        return undefined;
    }

    private Diag(code: DiagnosticCode, message: string, node: string | null): Diagnostic
    {
        return { code, severity: Severity.Error, message, span: null, node: node as Diagnostic["node"], path: null };
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
        const operation: WriteOperation = { Kind: kind, Key: node.storageId!, Fields: fields };
        const version = this.VersionOf(binding, node);
        return version === undefined ? operation : { ...operation, Version: version };
    }

    /** The instance's current version: the attr whose member maps (via FieldMap) to the binding's VersionField column. */
    private VersionOf(binding: ConnectorBinding, node: JsonNode): ExternalFieldValue | undefined
    {
        if (binding.VersionField === undefined) return undefined;
        const member = Object.keys(binding.FieldMap).find(key => binding.FieldMap[key] === binding.VersionField);
        if (member === undefined) return undefined;
        return node.attrs[member];
    }
}
