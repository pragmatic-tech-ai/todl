import type { IGraphQuery } from "../graph-api/index.js";
import type { IInstanceMirror } from "../manifest/reflection/reflection.js";
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

    public HasRelationshipType(relType: string): boolean
    {
        for (const concept of this.query.Concepts())
        {
            if (concept.getRelationships().some((r) => r.name === relType))
            {
                return true;
            }
        }
        return false;
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
        for (const r of mirror.type.getRelationships())
        {
            out.push(...this.query.Refs(nodeId, r.name));
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
