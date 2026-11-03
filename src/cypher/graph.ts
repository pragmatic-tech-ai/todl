import type { IGraphQuery } from "../graph-api/index.js";
import type { IInstanceMirror, ReflectedNode, TypeInfo } from "../manifest/reflection/reflection.js";
import { MetaKind } from "../manifest/enums.js";
import { RelDirection } from "./enums.js";
import { CypherSemanticError } from "./errors.js";

export interface ICypherGraph
{
    NodesByLabel(label: string): IInstanceMirror[];
    AllInstances(): IInstanceMirror[];
    Reflect(id: string): IInstanceMirror | undefined;
    Expand(nodeId: string, relType: string | undefined, direction: RelDirection): IInstanceMirror[];
    IsInstanceOf(mirror: IInstanceMirror, label: string): boolean;
    HasRelationshipType(relType: string): boolean;
    // Resolves a label (exact fullName, else unique simple name) to the concept fullName; throws CypherSemanticError if unknown/ambiguous.
    ResolveConcept(label: string): string;
    // Optional capability: true when Materialize can build decorated mirrors for nodes not (yet) in this graph. Write
    // queries use it for intra-query read-your-writes; without it they read the pre-query graph (and fail loud on
    // reads of nodes they created).
    CanMaterialize?(): boolean;
    Materialize?(node: ReflectedNode): IInstanceMirror | undefined;
}

export class GraphQueryAdapter implements ICypherGraph
{
    private static readonly UnknownLabel = "unknown label";
    private static readonly AmbiguousLabel = "ambiguous label";
    private static readonly UnknownDirection = "unknown relationship direction";

    constructor(private readonly query: IGraphQuery)
    {
    }

    public NodesByLabel(label: string): IInstanceMirror[]
    {
        const type = this.ResolveLabel(label);
        if (type === undefined)
        {
            throw new CypherSemanticError(`${GraphQueryAdapter.UnknownLabel} "${label}"`);
        }
        return this.query.InstancesOf(type.fullName);
    }

    public AllInstances(): IInstanceMirror[]
    {
        return this.query.AllInstances();
    }

    public Reflect(id: string): IInstanceMirror | undefined
    {
        return this.query.Reflect(id);
    }

    public Expand(nodeId: string, relType: string | undefined, direction: RelDirection): IInstanceMirror[]
    {
        switch (direction)
        {
            case RelDirection.Outgoing:
                return this.outgoing(nodeId, relType);
            case RelDirection.Incoming:
                return this.query.Referrers(nodeId, relType);
            case RelDirection.Undirected:
                return GraphQueryAdapter.dedup([...this.outgoing(nodeId, relType), ...this.query.Referrers(nodeId, relType)]);
        }
        throw new CypherSemanticError(`${GraphQueryAdapter.UnknownDirection} "${String(direction)}"`);
    }

    public IsInstanceOf(mirror: IInstanceMirror, label: string): boolean
    {
        const type = this.ResolveLabel(label);
        return type !== undefined && type.isAssignableFrom(mirror.type);
    }

    // Honest capability: only a query that itself implements Materialize (and so applies its own decoration) qualifies.
    public CanMaterialize(): boolean
    {
        return this.query.Materialize !== undefined;
    }

    public Materialize(node: ReflectedNode): IInstanceMirror | undefined
    {
        return this.query.Materialize?.(node);
    }

    public HasRelationshipType(relType: string): boolean
    {
        for (const concept of this.query.Concepts())
        {
            if (GraphQueryAdapter.EdgeMembers(concept).includes(relType))
            {
                return true;
            }
        }
        return false;
    }

    // The members a concept's instances traverse as edges: declared relationships plus reference-typed fields (a field
    // typed by a concept is an edge in TODL — type-directed references). Taxonomy-typed fields point at terms, not
    // instances, so they are not edges here.
    private static EdgeMembers(type: TypeInfo): string[]
    {
        const names = type.getRelationships().map((r) => r.name);
        for (const f of type.getFields())
        {
            if (f.fieldType?.kind === MetaKind.Concept) names.push(f.name);
        }
        return names;
    }

    public ResolveConcept(label: string): string
    {
        const type = this.ResolveLabel(label);
        if (type === undefined)
        {
            throw new CypherSemanticError(`${GraphQueryAdapter.UnknownLabel} "${label}"`);
        }
        return type.fullName;
    }

    private ResolveLabel(label: string): ReturnType<IGraphQuery["Type"]>
    {
        const exact = this.query.Type(label);
        if (exact !== undefined)
        {
            return exact;
        }
        const matches = this.query.Concepts().filter((c) => c.fullName.substring(c.fullName.lastIndexOf(".") + 1) === label);
        if (matches.length > 1)
        {
            throw new CypherSemanticError(`${GraphQueryAdapter.AmbiguousLabel} "${label}": ${matches.map((c) => c.fullName).join(", ")}`);
        }
        return matches[0];
    }

    private outgoing(nodeId: string, relType: string | undefined): IInstanceMirror[]
    {
        if (relType !== undefined)
        {
            return this.query.Refs(nodeId, relType);
        }
        const mirror = this.query.Reflect(nodeId);
        if (mirror === undefined)
        {
            return [];
        }
        const out: IInstanceMirror[] = [];
        for (const member of GraphQueryAdapter.EdgeMembers(mirror.type))
        {
            out.push(...this.query.Refs(nodeId, member));
        }
        return out;
    }

    private static dedup(mirrors: IInstanceMirror[]): IInstanceMirror[]
    {
        const seen = new Set<string>();
        const out: IInstanceMirror[] = [];
        for (const m of mirrors)
        {
            if (seen.has(m.node.id))
            {
                continue;
            }
            seen.add(m.node.id);
            out.push(m);
        }
        return out;
    }
}
