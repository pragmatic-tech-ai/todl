import type { Scalar } from "../manifest/logical.js";
import { Cardinality } from "../manifest/enums.js";
import type { IdGenerator } from "../compiler-services/model/id-generator.js";
import { Severity, type Diagnostic } from "../compiler-services/diagnostics/diagnostic.js";
import type { ICypherGraph } from "../cypher/graph.js";
import { CypherWriteError } from "../cypher/errors.js";
import { CypherWriteStats, type ICypherWriter } from "../cypher/writer.js";
import { ModelDraft, type ModelDraftState } from "./model-draft.js";

/**
 * Adapts a {@link ModelDraft} to the Cypher engine's write seam. Writes are origin-only
 * (only instances in the draft's own delta are writable), edges are strictly validated,
 * and a statement is atomic via Snapshot/Restore. `Rollback()` stays valid after
 * `Commit()` so the engine can revert if the post-commit projection throws.
 *
 * Usage: build a FRESH `CypherEngine(bake(draft), undefined, writer)` for every statement. The engine
 * fixes its read graph at construction, and the graph `Commit()` returns is used only for that query's
 * own projection, so reusing an engine after a write would read the pre-write graph.
 */
export class ModelDraftWriter implements ICypherWriter
{
    private static readonly Colon = ": ";
    private static readonly Semicolon = "; ";
    private static readonly NotWritable = "instance is not writable in this model";
    private static readonly UnknownConcept = "unknown concept";
    private static readonly DuplicateId = "generated id already exists";
    private static readonly UnknownMember = "unknown member";
    private static readonly TargetMissing = "relationship target does not exist";
    private static readonly TargetTypeMismatch = "relationship target does not satisfy member";
    private static readonly SingleValued = "member is single-valued and already set";
    private static readonly HasEdges = "cannot delete a node that still has relationships; use DETACH DELETE";
    private static readonly InvalidModel = "write rejected, the model would be invalid";
    private static readonly ErrorsCodes = " new error(s), codes ";
    private static readonly NoTransaction = "no write transaction is active";
    private static readonly DraftRejected = "write rejected by the model";

    private snapshot: ModelDraftState | undefined;
    private baseline = new Map<string, number>();
    private deleted = new Set<string>();
    private stats = new CypherWriteStats();

    constructor(
        private readonly draft: ModelDraft,
        private readonly ids: IdGenerator,
        private readonly bake: (draft: ModelDraft) => ICypherGraph,
    )
    {
    }

    public Begin(): void
    {
        this.snapshot = this.draft.Snapshot();
        this.baseline = ModelDraftWriter.Tally(this.Errors());
        this.deleted = new Set<string>();
        this.stats = new CypherWriteStats();
    }

    public Commit(): ICypherGraph
    {
        const fresh = this.NewErrors();
        if (fresh.length > 0)
        {
            throw new CypherWriteError(`${ModelDraftWriter.InvalidModel}${ModelDraftWriter.Colon}${fresh.length}${ModelDraftWriter.ErrorsCodes}${[...new Set(fresh.map((d) => d.code))].join(ModelDraftWriter.Semicolon)}`);
        }
        // The snapshot is deliberately kept: Rollback() must still work if the projection fails after this.
        return this.bake(this.draft);
    }

    public Rollback(): void
    {
        if (this.snapshot === undefined) throw new CypherWriteError(ModelDraftWriter.NoTransaction);
        this.draft.Restore(this.snapshot);
    }

    public Stats(): CypherWriteStats
    {
        return this.stats;
    }

    public CreateNode(concept: string, properties: ReadonlyMap<string, Scalar>): string
    {
        if (!this.draft.has(concept)) throw new CypherWriteError(`${ModelDraftWriter.UnknownConcept} "${concept}"`);
        const id = this.ids.next();
        if (this.draft.has(id)) throw new CypherWriteError(`${ModelDraftWriter.DuplicateId} "${id}"`);
        this.Guard(() =>
        {
            this.draft.create(concept, id);
            for (const [name, value] of properties) this.draft.setField(id, name, value);
        });
        this.stats.NodesCreated++;
        this.stats.PropertiesSet += properties.size;
        return id;
    }

    public SetProperty(nodeId: string, name: string, value: Scalar): void
    {
        this.RequireOwn(nodeId);
        if (this.draft.entity(nodeId)?.field(name) === value) return;
        this.Guard(() => this.draft.setField(nodeId, name, value));
        this.stats.PropertiesSet++;
    }

    public RemoveProperty(nodeId: string, name: string): void
    {
        this.RequireOwn(nodeId);
        if (this.draft.entity(nodeId)?.field(name) === undefined) return;
        this.Guard(() => this.draft.RemoveField(nodeId, name));
        this.stats.PropertiesSet++;
    }

    public CreateRelationship(fromId: string, member: string, toId: string): boolean
    {
        this.RequireOwn(fromId);
        if (!this.draft.has(toId)) throw new CypherWriteError(`${ModelDraftWriter.TargetMissing} "${toId}"`);
        const fromConcept = this.draft.resolve(fromId)?.type ?? undefined;
        const field = fromConcept === undefined
            ? undefined
            : this.draft.model.effectiveSchema(fromConcept).fields.find((f) => f.name === member);
        if (field === undefined) throw new CypherWriteError(`${ModelDraftWriter.UnknownMember} "${member}"`);
        if (!this.draft.referenceMembers(fromId, toId).some((f) => f.name === member))
        {
            throw new CypherWriteError(`${ModelDraftWriter.TargetTypeMismatch} "${member}"`);
        }
        const existing = this.RefIds(fromId, member);
        if (existing.includes(toId)) return false;
        if (existing.length > 0 && (field.cardinality === Cardinality.One || field.cardinality === Cardinality.Optional))
        {
            throw new CypherWriteError(`${ModelDraftWriter.SingleValued} "${member}"`);
        }
        this.Guard(() => this.draft.addRef(fromId, member, toId));
        this.stats.RelationshipsCreated++;
        return true;
    }

    public DeleteRelationship(fromId: string, member: string, toId: string): boolean
    {
        this.RequireOwn(fromId);
        if (!this.RefIds(fromId, member).includes(toId)) return false;
        this.Guard(() => this.draft.removeRef(fromId, member, toId));
        this.stats.RelationshipsDeleted++;
        return true;
    }

    public DeleteNode(nodeId: string, detach: boolean): void
    {
        // A node already deleted earlier in this statement (matched by several rows) is a no-op.
        if (this.deleted.has(nodeId)) return;
        this.RequireOwn(nodeId);
        const incident = this.draft.IncidentEdgeCount(nodeId);
        if (!detach && incident > 0) throw new CypherWriteError(`${ModelDraftWriter.HasEdges}${ModelDraftWriter.Colon}"${nodeId}"`);
        this.Guard(() => this.draft.remove(nodeId));
        this.deleted.add(nodeId);
        this.stats.NodesDeleted++;
        this.stats.RelationshipsDeleted += incident;
    }

    private RequireOwn(nodeId: string): void
    {
        if (!this.draft.Owns(nodeId)) throw new CypherWriteError(`${ModelDraftWriter.NotWritable}${ModelDraftWriter.Colon}"${nodeId}"`);
    }

    private RefIds(fromId: string, member: string): string[]
    {
        return this.draft.entity(fromId)?.refs(member).map((e) => e.id) ?? [];
    }

    private Errors(): Diagnostic[]
    {
        return this.draft.diagnostics.filter((d) => d.severity === Severity.Error);
    }

    private static Key(d: Diagnostic): string
    {
        return JSON.stringify([d.code, d.node, d.path, d.message]);
    }

    private static Tally(diagnostics: readonly Diagnostic[]): Map<string, number>
    {
        const counts = new Map<string, number>();
        for (const d of diagnostics)
        {
            const key = ModelDraftWriter.Key(d);
            counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        return counts;
    }

    // Errors beyond the Begin() baseline, compared as a multiset so a repeated occurrence of an existing error counts.
    private NewErrors(): Diagnostic[]
    {
        const remaining = new Map(this.baseline);
        const fresh: Diagnostic[] = [];
        for (const d of this.Errors())
        {
            const key = ModelDraftWriter.Key(d);
            const left = remaining.get(key) ?? 0;
            if (left > 0) remaining.set(key, left - 1);
            else fresh.push(d);
        }
        return fresh;
    }

    // Translate any ModelDraft failure into the engine's write error so the query rolls back.
    private Guard(action: () => void): void
    {
        try
        {
            action();
        }
        catch (e)
        {
            if (e instanceof CypherWriteError) throw e;
            throw new CypherWriteError(`${ModelDraftWriter.DraftRejected}${ModelDraftWriter.Colon}${e instanceof Error ? e.message : String(e)}`);
        }
    }
}
