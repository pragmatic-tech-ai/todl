import type { IServiceProvider } from "@pragmatic-tech-ai/todl-runtime";
import { DiagnosticCode, Severity, type Diagnostic } from "../compiler-services/diagnostics/diagnostic.js";
import type { JsonNode, TodlDocument } from "../compiler-services/emit/json.js";
import type { ConnectorBinding, ExternalFieldValue, ModelConnectorPlan, WriteBatch, WriteOperation, WriteResult, WriteTarget } from "./connector-plan.js";
import { ConnectorLookup, WriteOperationKind } from "./connector-plan.js";
import type { DataSourceAdapterCatalog } from "./data-source-adapter-catalog.js";

export interface FlushOutcome
{
    Results: readonly WriteResult[];
    Diagnostics: readonly Diagnostic[];
}

/** Tracks edits to populated instances and flushes them to every owning adapter (optimistic when the binding has a VersionField, else last-write-wins). */
export class ConnectorWorkingCopy
{
    private static readonly ReadOnlyMessage = "Cannot edit read-only connector binding for";
    private static readonly ConflictMessage = "Write conflict on";
    private static readonly KeySeparator = "\u0000";

    private readonly bindingsByKey = new Map<string, ConnectorBinding>();
    private readonly nodes = new Map<string, JsonNode>();
    private readonly pending = new Map<string, WriteOperationKind>();

    public constructor(
        private readonly plan: ModelConnectorPlan,
        document: TodlDocument,
        private readonly writeTargets: ReadonlyMap<string, readonly WriteTarget[]>,
    )
    {
        for (const binding of plan.Bindings)
        {
            this.bindingsByKey.set(ConnectorWorkingCopy.BindingKey(binding.Concept, binding.Connector, binding.Source), binding);
        }
        for (const node of document.nodes) this.nodes.set(node.id, node);
    }

    /** Records an upsert; returns a connector.read-only diagnostic (and records nothing) if every target binding is read-only. */
    public MarkDirty(instanceId: string): Diagnostic | undefined
    {
        return this.Record(instanceId, WriteOperationKind.Upsert);
    }

    /** Records a delete; returns a connector.read-only diagnostic (and records nothing) if every target binding is read-only. */
    public MarkDeleted(instanceId: string): Diagnostic | undefined
    {
        return this.Record(instanceId, WriteOperationKind.Delete);
    }

    /** Flushes pending edits to every source a canonical was drawn from; read-only sources yield connector.read-only, conflicts yield connector.write-conflict and stay pending. */
    public async Flush(catalog: DataSourceAdapterCatalog, services: IServiceProvider): Promise<FlushOutcome>
    {
        const batches = new Map<ConnectorBinding, WriteOperation[]>();
        const diagnostics: Diagnostic[] = [];

        for (const [instanceId, kind] of this.pending)
        {
            for (const target of this.writeTargets.get(instanceId) ?? [])
            {
                const binding = this.BindingFor(target, instanceId);
                if (binding === undefined) continue;
                if (!binding.Writable)
                {
                    diagnostics.push(this.ReadOnlyDiagnostic(binding.Concept, binding.Source, instanceId, null));
                    continue;
                }
                const operations = batches.get(binding) ?? [];
                operations.push(this.OperationFor(binding, instanceId, target.StorageId, kind));
                batches.set(binding, operations);
            }
        }

        const results: WriteResult[] = [];
        const failed = new Set<string>();
        for (const [binding, operations] of batches)
        {
            const batch: WriteBatch = binding.VersionField === undefined
                ? { Source: binding.Source, IdKey: binding.IdKey, Operations: operations }
                : { Source: binding.Source, IdKey: binding.IdKey, Operations: operations, VersionField: binding.VersionField };
            const adapter = await catalog.Open(ConnectorLookup.Find(this.plan.Connectors, binding), services);
            const result = await adapter.Apply(batch);
            results.push(result);
            for (const conflict of result.Conflicts)
            {
                diagnostics.push(this.BuildDiagnostic(DiagnosticCode.ConnectorWriteConflict,
                    `${ConnectorWorkingCopy.ConflictMessage} ${binding.Concept} ${String(conflict.Key)}: ${conflict.Reason}`, null));
                failed.add(ConnectorWorkingCopy.TargetKey(binding.Concept, binding.Connector, binding.Source, conflict.Key));
            }
        }

        for (const instanceId of [...this.pending.keys()])
        {
            const concept = this.nodes.get(instanceId)?.type;
            const conflicted = concept != null && (this.writeTargets.get(instanceId) ?? []).some(target =>
                failed.has(ConnectorWorkingCopy.TargetKey(concept, target.Connector, target.Source, target.StorageId)));
            if (!conflicted) this.pending.delete(instanceId);
        }
        return { Results: results, Diagnostics: diagnostics };
    }

    /** A canonical whose targets resolve to no writable binding (including none matching at all) is treated as read-only and yields connector.read-only. */
    private Record(instanceId: string, kind: WriteOperationKind): Diagnostic | undefined
    {
        const targets = this.writeTargets.get(instanceId) ?? [];
        const anyWritable = targets.some(target => this.BindingFor(target, instanceId)?.Writable === true);
        if (targets.length > 0 && !anyWritable)
        {
            const concept = this.nodes.get(instanceId)?.type ?? "";
            return this.ReadOnlyDiagnostic(concept, null, instanceId, instanceId);
        }
        this.pending.set(instanceId, kind);
        return undefined;
    }

    private static BindingKey(concept: string, connector: string, source: string): string
    {
        const separator = ConnectorWorkingCopy.KeySeparator;
        return `${concept}${separator}${connector}${separator}${source}`;
    }

    private static TargetKey(concept: string, connector: string, source: string, key: ExternalFieldValue): string
    {
        return `${ConnectorWorkingCopy.BindingKey(concept, connector, source)}${ConnectorWorkingCopy.KeySeparator}${String(key)}`;
    }

    /** Uniform connector.read-only diagnostic: concept, then the source when known, then the instance id. */
    private ReadOnlyDiagnostic(concept: string, source: string | null, instanceId: string, node: Diagnostic["node"]): Diagnostic
    {
        const where = source === null ? instanceId : `${source} ${instanceId}`;
        return this.BuildDiagnostic(DiagnosticCode.ConnectorReadOnly, `${ConnectorWorkingCopy.ReadOnlyMessage} ${concept} (${where})`, node);
    }

    private BuildDiagnostic(code: DiagnosticCode, message: string, node: Diagnostic["node"]): Diagnostic
    {
        return { code, severity: Severity.Error, message, span: null, node, path: null };
    }

    private BindingFor(target: WriteTarget, instanceId: string): ConnectorBinding | undefined
    {
        const node = this.nodes.get(instanceId);
        if (node?.type == null) return undefined;
        return this.bindingsByKey.get(ConnectorWorkingCopy.BindingKey(node.type, target.Connector, target.Source));
    }

    private OperationFor(binding: ConnectorBinding, instanceId: string, storageId: string, kind: WriteOperationKind): WriteOperation
    {
        const node = this.nodes.get(instanceId)!;
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
        const operation: WriteOperation = { Kind: kind, Key: storageId, Fields: fields };
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
