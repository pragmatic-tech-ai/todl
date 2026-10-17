import type { IServiceProvider } from "@pragmatic-tech-ai/todl-runtime";
import { DiagnosticCode, Severity, type Diagnostic } from "../compiler-services/diagnostics/diagnostic.js";
import type { JsonNode, TodlDocument } from "../compiler-services/emit/json.js";
import type { ConnectorBinding, ExternalFieldValue, ModelConnectorPlan, WriteBatch, WriteFailure, WriteOperation, WriteResult, WriteTarget } from "./connector-plan.js";
import { ConnectorLookup, WriteAtomicity, WriteConcurrency, WriteFailureKind, WriteOperationKind } from "./connector-plan.js";
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
    private static readonly WriteFailedMessage = "Write failed on";
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

    /** Flushes pending edits to every source a canonical was drawn from, one binding at a time and
     *  isolated from the others (a thrown adapter error fails just that binding). Each binding's batch
     *  carries its authored Concurrency/Atomicity/VersionField. Read-only sources yield
     *  connector.read-only; a conflict yields connector.write-conflict, any other failure
     *  connector.write-failed. Failed ops stay pending; a rolled-back transactional batch keeps ALL of
     *  its ops pending. Cross-binding/cross-adapter writes are NOT atomic. */
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
        // Target keys whose pending edit must survive this Flush (a failure, or a rolled-back
        // transactional batch that applied nothing). Cross-binding writes are independent: a
        // failure in one binding never retains another's ops.
        const retained = new Set<string>();
        for (const [binding, operations] of batches)
        {
            // Honor the binding's authored axes, defaulting to the weakest guarantees when absent.
            const concurrency = binding.Concurrency ?? WriteConcurrency.LastWriteWins;
            const atomicity = binding.Atomicity ?? WriteAtomicity.Sequential;
            const batch: WriteBatch = {
                Source: binding.Source,
                IdKey: binding.IdKey,
                Operations: operations,
                Concurrency: concurrency,
                Atomicity: atomicity,
                ...(binding.VersionField === undefined ? {} : { VersionField: binding.VersionField }),
            };
            const result = await this.ApplyBatch(catalog, services, binding, batch, operations);
            results.push(result);

            // A transactional batch that applied nothing rolled back wholesale: the backend returns
            // only the faulting op in Failures, so every op in the batch must stay pending — not just
            // the reported one. A sequential batch retains exactly the ops it reported as failures.
            const rolledBack = atomicity === WriteAtomicity.Transactional && result.Applied === 0 && operations.length > 0;
            const failedKeys = new Set(result.Failures.map(failure => String(failure.Key)));
            for (const operation of operations)
            {
                if (rolledBack || failedKeys.has(String(operation.Key)))
                {
                    retained.add(ConnectorWorkingCopy.TargetKey(binding.Concept, binding.Connector, binding.Source, operation.Key));
                }
            }
            for (const failure of result.Failures)
            {
                diagnostics.push(this.FailureDiagnostic(binding, failure));
            }
        }

        for (const instanceId of [...this.pending.keys()])
        {
            const concept = this.nodes.get(instanceId)?.type;
            const keep = concept != null && (this.writeTargets.get(instanceId) ?? []).some(target =>
                retained.has(ConnectorWorkingCopy.TargetKey(concept, target.Connector, target.Source, target.StorageId)));
            if (!keep) this.pending.delete(instanceId);
        }
        return { Results: results, Diagnostics: diagnostics };
    }

    /** Applies one binding's batch, isolating it: a THROWN adapter error becomes an Error failure for
     *  every op in the batch (so they all stay pending) and never aborts the rest of the Flush. */
    private async ApplyBatch(catalog: DataSourceAdapterCatalog, services: IServiceProvider, binding: ConnectorBinding, batch: WriteBatch, operations: readonly WriteOperation[]): Promise<WriteResult>
    {
        const adapter = await catalog.Open(ConnectorLookup.Find(this.plan.Connectors, binding), services);
        try
        {
            return await adapter.Apply(batch);
        }
        catch (error)
        {
            const reason = error instanceof Error ? error.message : String(error);
            return { Applied: 0, Failures: operations.map(operation => ({ Key: operation.Key, Kind: WriteFailureKind.Error, Reason: reason })) };
        }
    }

    /** One diagnostic per write failure: a version clash keeps the connector.write-conflict code; every
     *  other kind (driver Error, Unsupported) surfaces as connector.write-failed carrying the Reason. */
    private FailureDiagnostic(binding: ConnectorBinding, failure: WriteFailure): Diagnostic
    {
        if (failure.Kind === WriteFailureKind.Conflict)
        {
            return this.BuildDiagnostic(DiagnosticCode.ConnectorWriteConflict,
                `${ConnectorWorkingCopy.ConflictMessage} ${binding.Concept} ${String(failure.Key)}: ${failure.Reason}`, null);
        }
        return this.BuildDiagnostic(DiagnosticCode.ConnectorWriteFailed,
            `${ConnectorWorkingCopy.WriteFailedMessage} ${binding.Concept} ${String(failure.Key)}: ${failure.Reason}`, null);
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
