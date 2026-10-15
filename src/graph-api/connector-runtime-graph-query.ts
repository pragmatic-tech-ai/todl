import type { IGraphQuery } from "./graph-query.js";
import type { InstanceMirror, IInstanceMirror, TypeInfo, TermInfo } from "../manifest/reflection/reflection.js";

/** Serves connector-backed concepts from a pre-built snapshot; everything else from the base graph. Fully synchronous. */
export class ConnectorRuntimeGraphQuery implements IGraphQuery
{
    public constructor(
        private readonly base: IGraphQuery,
        private readonly connectorInstances: ReadonlyMap<string, readonly InstanceMirror[]>,
        private readonly defaultConcepts: ReadonlySet<string> = new Set())
    {
    }

    // A snapshot concept is served SOLELY from the snapshot (the adapter is the system of record); base-graph rows are intentionally
    // not merged. Exception: default-backed concepts return base (seed) rows UNIONed with the snapshot (seed + store).
    public InstancesOf(conceptId: string): IInstanceMirror[]
    {
        const fetched = this.connectorInstances.get(conceptId);
        if (fetched === undefined)
        {
            return this.base.InstancesOf(conceptId);
        }
        if (this.defaultConcepts.has(conceptId))
        {
            return [...this.base.InstancesOf(conceptId), ...fetched];
        }
        return [...fetched];
    }

    // Same union/shadow rule as InstancesOf: a base mirror is dropped when its concept is in the snapshot but not default-backed
    // (the adapter is the system of record); default-backed and non-snapshot concepts keep their base rows. Snapshot rows are appended.
    public AllInstances(): IInstanceMirror[]
    {
        const all: IInstanceMirror[] = [];
        for (const mirror of this.base.AllInstances())
        {
            const concept = mirror.type?.fullName;
            const shadowed = concept !== undefined && this.connectorInstances.has(concept) && !this.defaultConcepts.has(concept);
            if (!shadowed)
            {
                all.push(mirror);
            }
        }
        for (const mirrors of this.connectorInstances.values())
        {
            all.push(...mirrors);
        }
        return all;
    }

    public Reflect(id: string): IInstanceMirror | undefined
    {
        for (const mirrors of this.connectorInstances.values())
        {
            const hit = mirrors.find(m => m.node.id === id);
            if (hit !== undefined)
            {
                return hit;
            }
        }
        return this.base.Reflect(id);
    }

    public Refs(id: string, member: string): IInstanceMirror[]
    {
        return this.base.Refs(id, member);
    }

    public Referrers(id: string, member?: string): IInstanceMirror[]
    {
        return this.base.Referrers(id, member);
    }

    public Search(text: string): IInstanceMirror[]
    {
        return this.base.Search(text);
    }

    public Concepts(): TypeInfo[]
    {
        return this.base.Concepts();
    }

    public Type(name: string): TypeInfo | undefined
    {
        return this.base.Type(name);
    }

    public Term(id: string): TermInfo | undefined
    {
        return this.base.Term(id);
    }

    public Narrower(termId: string): TermInfo[]
    {
        return this.base.Narrower(termId);
    }

    public Broader(termId: string): TermInfo[]
    {
        return this.base.Broader(termId);
    }

    public Descendants(termId: string): TermInfo[]
    {
        return this.base.Descendants(termId);
    }

    public Ancestors(termId: string): TermInfo[]
    {
        return this.base.Ancestors(termId);
    }

    public IconKey(typeId: string): string | undefined
    {
        return this.base.IconKey(typeId);
    }
}
