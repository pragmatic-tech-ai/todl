import type { IGraphQuery } from "./graph-query.js";
import type { InstanceMirror, TypeInfo, TermInfo } from "../manifest/reflection/reflection.js";

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
    public InstancesOf(conceptId: string): InstanceMirror[]
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

    // Base instances plus the snapshot's, unmerged: the adapter is the system of record for a snapshot concept, so its snapshot rows
    // are authoritative and base-graph rows for that concept (including subtype rows) are intentionally not reconciled with them.
    public AllInstances(): InstanceMirror[]
    {
        const all: InstanceMirror[] = [...this.base.AllInstances()];
        for (const mirrors of this.connectorInstances.values())
        {
            all.push(...mirrors);
        }
        return all;
    }

    public Reflect(id: string): InstanceMirror | undefined
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

    public Refs(id: string, member: string): InstanceMirror[]
    {
        return this.base.Refs(id, member);
    }

    public Referrers(id: string, member?: string): InstanceMirror[]
    {
        return this.base.Referrers(id, member);
    }

    public Search(text: string): InstanceMirror[]
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
