import type { Scalar } from "../manifest/logical.js";
import type { FieldView, IInstanceMirror, ReflectedNode, TermInfo, TypeInfo } from "../manifest/reflection/reflection.js";
import type { ICypherGraph } from "./graph.js";
import type { CypherWriteStats, ICypherWriter } from "./writer.js";
import { RelDirection } from "./enums.js";

// Intra-query read-your-writes for Cypher write queries. The write pipeline reads through an OverlayCypherGraph that
// layers this query's uncommitted mutations (recorded by OverlayRecordingWriter as the real writer accepts them) over the
// immutable pre-query graph. Mirrors for created / changed nodes are built by the base graph's Materialize, so they carry
// exactly the decoration (field masking, filtering) the host applies to its own mirrors; a base graph that cannot
// materialize never gets an overlay (see ICypherGraph.CanMaterialize). The overlay lives for one write and is dropped at
// commit; the final projection still reads the committed graph.

// One (from)-[member]->(to) reference.
class OverlayEdge
{
    constructor(public readonly From: string, public readonly Member: string, public readonly To: string)
    {
    }

    public Key(): string
    {
        return JSON.stringify([this.From, this.Member, this.To]);
    }
}

class CreatedNode
{
    constructor(public readonly Type: string, public readonly Attrs: Map<string, Scalar>)
    {
    }
}

class MaterializedEntry
{
    constructor(public readonly Version: number, public readonly Mirror: IInstanceMirror | undefined)
    {
    }
}

export class WriteOverlay
{
    private readonly created = new Map<string, CreatedNode>();
    // Attribute changes on pre-query nodes; null marks a removed attribute.
    private readonly changedAttrs = new Map<string, Map<string, Scalar | null>>();
    private readonly deletedNodes = new Set<string>();
    private readonly addedEdges = new Map<string, OverlayEdge>();
    private readonly deletedEdges = new Map<string, OverlayEdge>();
    private readonly materialized = new Map<string, MaterializedEntry>();
    // Every node id this query created, changed, deleted or added/removed an outgoing reference from.
    private readonly touched = new Set<string>();
    private version = 0;

    public readonly Graph: OverlayCypherGraph;

    constructor(private readonly base: ICypherGraph)
    {
        this.Graph = new OverlayCypherGraph(this, base);
    }

    public RecordCreate(id: string, concept: string, properties: ReadonlyMap<string, Scalar>): void
    {
        this.created.set(id, new CreatedNode(concept, new Map(properties)));
        this.touched.add(id);
        this.version++;
    }

    public RecordSet(id: string, name: string, value: Scalar): void
    {
        this.ChangeAttr(id, name, value);
    }

    public RecordRemove(id: string, name: string): void
    {
        this.ChangeAttr(id, name, null);
    }

    public RecordAddEdge(from: string, member: string, to: string): void
    {
        const edge = new OverlayEdge(from, member, to);
        // Re-adding a pre-query edge this query deleted simply cancels the deletion.
        if (!this.deletedEdges.delete(edge.Key())) this.addedEdges.set(edge.Key(), edge);
        this.touched.add(from);
        this.version++;
    }

    public RecordDeleteEdge(from: string, member: string, to: string): void
    {
        const edge = new OverlayEdge(from, member, to);
        if (!this.addedEdges.delete(edge.Key())) this.deletedEdges.set(edge.Key(), edge);
        this.touched.add(from);
        this.version++;
    }

    public RecordDeleteNode(id: string): void
    {
        this.deletedNodes.add(id);
        this.touched.add(id);
        this.version++;
    }

    public IsDeleted(id: string): boolean
    {
        return this.deletedNodes.has(id);
    }

    public IsTouched(id: string): boolean
    {
        return this.touched.has(id);
    }

    public IsCreated(id: string): boolean
    {
        return this.created.has(id);
    }

    public CreatedIds(): string[]
    {
        return [...this.created.keys()];
    }

    public AddedEdges(): IterableIterator<OverlayEdge>
    {
        return this.addedEdges.values();
    }

    public DeletedEdges(): IterableIterator<OverlayEdge>
    {
        return this.deletedEdges.values();
    }

    // The node as it stands right now in this query: undefined if deleted (or unknown); a materialized mirror if this
    // query created or changed it; otherwise the base graph's own mirror.
    public Current(id: string): IInstanceMirror | undefined
    {
        if (this.deletedNodes.has(id)) return undefined;
        if (!this.touched.has(id)) return this.base.Reflect(id);
        const cached = this.materialized.get(id);
        if (cached !== undefined && cached.Version === this.version) return cached.Mirror;
        const node = this.Synthesize(id);
        const mirror = node === undefined ? undefined : this.base.Materialize?.(node);
        this.materialized.set(id, new MaterializedEntry(this.version, mirror));
        return mirror;
    }

    private ChangeAttr(id: string, name: string, value: Scalar | null): void
    {
        const created = this.created.get(id);
        if (created !== undefined)
        {
            if (value === null) created.Attrs.delete(name);
            else created.Attrs.set(name, value);
        }
        else
        {
            let changes = this.changedAttrs.get(id);
            if (changes === undefined)
            {
                changes = new Map<string, Scalar | null>();
                this.changedAttrs.set(id, changes);
            }
            changes.set(name, value);
        }
        this.touched.add(id);
        this.version++;
    }

    // The node's reflected shape with this query's changes applied. A changed pre-query node starts from the base
    // mirror's node, which is already decorated (masked) — re-materializing it re-applies the same decoration.
    private Synthesize(id: string): ReflectedNode | undefined
    {
        const created = this.created.get(id);
        if (created !== undefined)
        {
            return { id, type: created.Type, class: null, attrs: Object.fromEntries(created.Attrs), refs: this.Refs(id, {}) };
        }
        const base = this.base.Reflect(id);
        if (base === undefined) return undefined;
        const attrs: Record<string, Scalar> = { ...base.node.attrs };
        for (const [name, value] of this.changedAttrs.get(id) ?? [])
        {
            if (value === null) delete attrs[name];
            else attrs[name] = value;
        }
        return { ...base.node, attrs, refs: this.Refs(id, base.node.refs ?? {}) };
    }

    private Refs(id: string, baseRefs: Readonly<Record<string, string[]>>): Record<string, string[]>
    {
        const refs: Record<string, string[]> = {};
        for (const [member, targets] of Object.entries(baseRefs)) refs[member] = [...targets];
        for (const e of this.deletedEdges.values())
        {
            if (e.From !== id) continue;
            const list = refs[e.Member];
            const at = list === undefined ? -1 : list.indexOf(e.To);
            if (at >= 0) list!.splice(at, 1);
        }
        for (const e of this.addedEdges.values())
        {
            if (e.From !== id) continue;
            (refs[e.Member] ??= []).push(e.To);
        }
        for (const member of Object.keys(refs)) refs[member] = refs[member]!.filter((t) => !this.deletedNodes.has(t));
        return refs;
    }
}

// A live view of one node: every read goes through the overlay's current state, so a SET applied after this mirror was
// handed out is still observed. A deleted node keeps its id and type but reads as having no fields.
export class OverlayMirror implements IInstanceMirror
{
    constructor(private readonly overlay: WriteOverlay, private readonly id: string, private readonly firstSeen: IInstanceMirror)
    {
    }

    public get node(): ReflectedNode
    {
        return this.Live()?.node ?? this.firstSeen.node;
    }

    public get type(): TypeInfo
    {
        return this.firstSeen.type;
    }

    public get class(): TermInfo | undefined
    {
        return this.Live()?.class ?? this.firstSeen.class;
    }

    public fields(): FieldView[]
    {
        return this.Live()?.fields() ?? [];
    }

    public field(name: string): FieldView | undefined
    {
        return this.Live()?.field(name);
    }

    // An untouched node is exactly its first-seen mirror (no per-read re-reflection); a touched one reads current state.
    private Live(): IInstanceMirror | undefined
    {
        return this.overlay.IsTouched(this.id) ? this.overlay.Current(this.id) : this.firstSeen;
    }
}

export class OverlayCypherGraph implements ICypherGraph
{
    constructor(private readonly overlay: WriteOverlay, private readonly base: ICypherGraph)
    {
    }

    public NodesByLabel(label: string): IInstanceMirror[]
    {
        const out = this.Visible(this.base.NodesByLabel(label));
        for (const m of this.CreatedMirrors())
        {
            if (this.base.IsInstanceOf(m, label)) out.push(m);
        }
        return out;
    }

    public AllInstances(): IInstanceMirror[]
    {
        return [...this.Visible(this.base.AllInstances()), ...this.CreatedMirrors()];
    }

    public Reflect(id: string): IInstanceMirror | undefined
    {
        const current = this.overlay.Current(id);
        return current === undefined ? undefined : this.Wrap(current);
    }

    public Expand(nodeId: string, relType: string | undefined, direction: RelDirection): IInstanceMirror[]
    {
        if (this.overlay.IsDeleted(nodeId)) return [];
        if (direction === RelDirection.Outgoing) return this.Outgoing(nodeId, relType);
        if (direction === RelDirection.Incoming) return this.Incoming(nodeId, relType);
        return OverlayCypherGraph.Dedup([...this.Outgoing(nodeId, relType), ...this.Incoming(nodeId, relType)]);
    }

    public IsInstanceOf(mirror: IInstanceMirror, label: string): boolean
    {
        return this.base.IsInstanceOf(mirror, label);
    }

    public HasRelationshipType(relType: string): boolean
    {
        return this.base.HasRelationshipType(relType);
    }

    public ResolveConcept(label: string): string
    {
        return this.base.ResolveConcept(label);
    }

    public CanMaterialize(): boolean
    {
        return this.base.CanMaterialize?.() === true;
    }

    public Materialize(node: ReflectedNode): IInstanceMirror | undefined
    {
        return this.base.Materialize?.(node);
    }

    // Base expansion is a multiset (one entry per edge), so each deleted edge removes exactly one occurrence of its
    // endpoint; created edges add one each.
    private Outgoing(nodeId: string, relType: string | undefined): IInstanceMirror[]
    {
        const remaining = this.overlay.IsCreated(nodeId) ? [] : [...this.base.Expand(nodeId, relType, RelDirection.Outgoing)];
        for (const e of this.overlay.DeletedEdges())
        {
            if (e.From === nodeId && OverlayCypherGraph.Matches(e.Member, relType)) OverlayCypherGraph.RemoveOne(remaining, e.To);
        }
        const out = this.Visible(remaining);
        for (const e of this.overlay.AddedEdges())
        {
            if (e.From !== nodeId || !OverlayCypherGraph.Matches(e.Member, relType)) continue;
            const target = this.Reflect(e.To);
            if (target !== undefined) out.push(target);
        }
        return out;
    }

    private Incoming(nodeId: string, relType: string | undefined): IInstanceMirror[]
    {
        const remaining = this.overlay.IsCreated(nodeId) ? [] : [...this.base.Expand(nodeId, relType, RelDirection.Incoming)];
        for (const e of this.overlay.DeletedEdges())
        {
            if (e.To === nodeId && OverlayCypherGraph.Matches(e.Member, relType)) OverlayCypherGraph.RemoveOne(remaining, e.From);
        }
        const out = this.Visible(remaining);
        for (const e of this.overlay.AddedEdges())
        {
            if (e.To !== nodeId || !OverlayCypherGraph.Matches(e.Member, relType)) continue;
            const source = this.Reflect(e.From);
            if (source !== undefined) out.push(source);
        }
        return out;
    }

    private CreatedMirrors(): IInstanceMirror[]
    {
        const out: IInstanceMirror[] = [];
        for (const id of this.overlay.CreatedIds())
        {
            const m = this.Reflect(id);
            if (m !== undefined) out.push(m);
        }
        return out;
    }

    // Drops deleted nodes and replaces every survivor with a live overlay mirror.
    private Visible(mirrors: readonly IInstanceMirror[]): IInstanceMirror[]
    {
        const out: IInstanceMirror[] = [];
        for (const m of mirrors)
        {
            if (!this.overlay.IsDeleted(m.node.id)) out.push(this.Wrap(m));
        }
        return out;
    }

    private Wrap(mirror: IInstanceMirror): IInstanceMirror
    {
        return mirror instanceof OverlayMirror ? mirror : new OverlayMirror(this.overlay, mirror.node.id, mirror);
    }

    private static Matches(member: string, relType: string | undefined): boolean
    {
        return relType === undefined || member === relType;
    }

    private static RemoveOne(mirrors: IInstanceMirror[], id: string): void
    {
        const at = mirrors.findIndex((m) => m.node.id === id);
        if (at >= 0) mirrors.splice(at, 1);
    }

    private static Dedup(mirrors: IInstanceMirror[]): IInstanceMirror[]
    {
        const seen = new Set<string>();
        const out: IInstanceMirror[] = [];
        for (const m of mirrors)
        {
            if (seen.has(m.node.id)) continue;
            seen.add(m.node.id);
            out.push(m);
        }
        return out;
    }
}

// Forwards every mutation to the real writer and records it in the overlay only once the writer has accepted it, so a
// rejected write never becomes visible.
export class OverlayRecordingWriter implements ICypherWriter
{
    constructor(private readonly inner: ICypherWriter, private readonly overlay: WriteOverlay)
    {
    }

    public CreateNode(concept: string, properties: ReadonlyMap<string, Scalar>): string
    {
        const id = this.inner.CreateNode(concept, properties);
        this.overlay.RecordCreate(id, concept, properties);
        return id;
    }

    public SetProperty(nodeId: string, name: string, value: Scalar): void
    {
        this.inner.SetProperty(nodeId, name, value);
        this.overlay.RecordSet(nodeId, name, value);
    }

    public RemoveProperty(nodeId: string, name: string): void
    {
        this.inner.RemoveProperty(nodeId, name);
        this.overlay.RecordRemove(nodeId, name);
    }

    public CreateRelationship(fromId: string, member: string, toId: string): boolean
    {
        const added = this.inner.CreateRelationship(fromId, member, toId);
        if (added) this.overlay.RecordAddEdge(fromId, member, toId);
        return added;
    }

    public DeleteRelationship(fromId: string, member: string, toId: string): boolean
    {
        const removed = this.inner.DeleteRelationship(fromId, member, toId);
        if (removed) this.overlay.RecordDeleteEdge(fromId, member, toId);
        return removed;
    }

    public DeleteNode(nodeId: string, detach: boolean): void
    {
        this.inner.DeleteNode(nodeId, detach);
        this.overlay.RecordDeleteNode(nodeId);
    }

    public Begin(): void
    {
        this.inner.Begin();
    }

    public Commit(): ICypherGraph
    {
        return this.inner.Commit();
    }

    public Rollback(): void
    {
        this.inner.Rollback();
    }

    public Stats(): CypherWriteStats
    {
        return this.inner.Stats();
    }
}
