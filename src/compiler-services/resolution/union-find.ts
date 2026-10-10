/** A disjoint-set (union-find) with path compression. Used by the resolution
 * pass to cluster instances that are the same entity under identity-key equality
 * and match rules, then collapse each cluster to a canonical node. */
export class DisjointSet<T>
{
    private readonly parent = new Map<T, T>();

    public Add(x: T): void
    {
        if (!this.parent.has(x)) this.parent.set(x, x);
    }

    public Find(x: T): T
    {
        this.Add(x);
        let root = x;
        while (this.parent.get(root) !== root) root = this.parent.get(root)!;
        // path compression
        let cur = x;
        while (this.parent.get(cur) !== root)
        {
            const next = this.parent.get(cur)!;
            this.parent.set(cur, root);
            cur = next;
        }
        return root;
    }

    public Union(a: T, b: T): void
    {
        const ra = this.Find(a);
        const rb = this.Find(b);
        if (ra === rb) return;
        this.parent.set(rb, ra);
    }

    public Clusters(): T[][]
    {
        const groups = new Map<T, T[]>();
        for (const x of this.parent.keys())
        {
            const root = this.Find(x);
            const bucket = groups.get(root);
            if (bucket === undefined) groups.set(root, [x]);
            else bucket.push(x);
        }
        return [...groups.values()];
    }
}
