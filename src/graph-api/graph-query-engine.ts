// The reflection-native query engine (arc 1b-i): answers the graph query surface from
// the FrozenGraph substrate (loaded manifests + flattened heap), returning reflection
// handles. A lazy reverse-ref index backs Referrers (the heap has only forward refs).

import type { FrozenGraph } from "../domain/graph.js";
import type { TypeInfo, InstanceMirror, TermInfo } from "../manifest/reflection/reflection.js";
import { MetaKind } from "../manifest/enums.js";
import { Snapshot } from "./snapshot.js";
import type { IGraphQuery } from "./graph-query.js";

interface ReverseRef { from: string; member: string; }

export class GraphQuery implements IGraphQuery
{
    private static readonly IconAnnotation = "icon";
    private static readonly IconPathArg = "path";

    private reverse?: Map<string, ReverseRef[]>;

    constructor(private readonly graph: FrozenGraph) {}

    public IconKey(typeId: string): string | undefined
    {
        const owner = this.graph.ownerOf(typeId);
        if (owner === undefined) return undefined;
        const type = owner.getType(typeId);
        if (type === undefined) return undefined;
        const icon = type.getAnnotations().find((a) => a.type.name === GraphQuery.IconAnnotation);
        if (icon === undefined) return undefined;
        const path = icon.args.get(GraphQuery.IconPathArg);
        if (typeof path !== "string") return undefined;
        return `${owner.model}/${owner.version}/${path}`;
    }

    public Concepts(): TypeInfo[]
    {
        const byName = new Map<string, TypeInfo>();
        for (const m of this.graph.manifests)
        {
            const rootToken = m.root().token;
            const rootName = rootToken !== 0 ? m.root().fullName : ""; // guard: row 0 = no root declared
            for (const t of m.types())
                if (t.kind === MetaKind.Concept && t.fullName !== rootName) byName.set(t.fullName, t);
        }
        return [...byName.values()];
    }

    public Type(name: string): TypeInfo | undefined
    {
        return this.graph.getType(name);
    }

    public InstancesOf(conceptId: string): InstanceMirror[]
    {
        const concept = this.graph.getType(conceptId);
        if (concept === undefined) return [];
        const out: InstanceMirror[] = [];
        for (const node of this.graph.allNodes())
        {
            if (this.graph.ownerOf(node.type) === undefined) continue;
            const mirror = this.graph.reflect(node);
            if (concept.isAssignableFrom(mirror.type)) out.push(mirror);
        }
        return out;
    }

    public Reflect(id: string): InstanceMirror | undefined
    {
        const node = this.graph.getNode(id);
        if (node === undefined || this.graph.ownerOf(node.type) === undefined) return undefined;
        return this.graph.reflect(node);
    }

    public Refs(id: string, member: string): InstanceMirror[]
    {
        const node = this.graph.getNode(id);
        return this.reflectAll(node?.refs?.[member] ?? []);
    }

    public Referrers(id: string, member?: string): InstanceMirror[]
    {
        const hits = this.reverseIndex().get(id) ?? [];
        const ids = hits.filter((h) => member === undefined || h.member === member).map((h) => h.from);
        return this.reflectAll(ids);
    }

    public Search(text: string): InstanceMirror[]
    {
        const needle = text.toLowerCase();
        const out: InstanceMirror[] = [];
        for (const node of this.graph.allNodes())
        {
            if (this.graph.ownerOf(node.type) === undefined) continue;
            const mirror = this.graph.reflect(node);
            if (Snapshot.LabelOf(mirror).toLowerCase().includes(needle) || node.id.toLowerCase().includes(needle))
                out.push(mirror);
        }
        return out;
    }

    public Term(id: string): TermInfo | undefined
    {
        for (const m of this.graph.manifests)
        {
            const term = m.getTerm(id);
            if (term !== undefined) return term;
        }
        return undefined;
    }

    public Narrower(termId: string): TermInfo[]
    {
        return this.Term(termId)?.narrower() ?? [];
    }

    public Broader(termId: string): TermInfo[]
    {
        const broader = this.Term(termId)?.broader;
        return broader === undefined ? [] : [broader];
    }

    public Descendants(termId: string): TermInfo[]
    {
        return this.walk(this.Term(termId), (t) => t.narrower());
    }

    public Ancestors(termId: string): TermInfo[]
    {
        return this.walk(this.Term(termId), (t) => (t.broader === undefined ? [] : [t.broader]));
    }

    private reflectAll(ids: readonly string[]): InstanceMirror[]
    {
        const out: InstanceMirror[] = [];
        for (const id of ids)
        {
            const mirror = this.Reflect(id);
            if (mirror !== undefined) out.push(mirror);
        }
        return out;
    }

    private reverseIndex(): Map<string, ReverseRef[]>
    {
        if (this.reverse !== undefined) return this.reverse;
        const index = new Map<string, ReverseRef[]>();
        for (const node of this.graph.allNodes())
        {
            for (const [member, targets] of Object.entries(node.refs ?? {}))
            {
                for (const to of targets)
                {
                    let bucket = index.get(to);
                    if (bucket === undefined) { bucket = []; index.set(to, bucket); }
                    bucket.push({ from: node.id, member });
                }
            }
        }
        this.reverse = index;
        return index;
    }

    private walk(start: TermInfo | undefined, next: (t: TermInfo) => TermInfo[]): TermInfo[]
    {
        if (start === undefined) return [];
        const out: TermInfo[] = [];
        const seen = new Set<string>();
        const queue: TermInfo[] = [...next(start)];
        while (queue.length > 0)
        {
            const term = queue.shift()!;
            if (seen.has(term.id)) continue;
            seen.add(term.id);
            out.push(term);
            queue.push(...next(term));
        }
        return out;
    }
}
