import { CypherValue, NodeValue, type CypherValueDto } from "./values.js";

export type RelDto = { from: string; type: string; to: string };

export class ListValue extends CypherValue
{
    private static readonly GroupKeyPrefix = "list:";
    private static readonly ListRank = 4;

    constructor(public readonly Items: readonly CypherValue[])
    {
        super();
    }

    public ToDto(): CypherValueDto
    {
        return this.Items.map(i => i.ToDto());
    }

    public GroupKey(): string
    {
        return ListValue.GroupKeyPrefix + JSON.stringify(this.Items.map(i => i.GroupKey()));
    }

    protected TypeRank(): number
    {
        return ListValue.ListRank;
    }

    protected CompareSameType(other: CypherValue): number
    {
        const o = (other as ListValue).Items;
        const n = Math.min(this.Items.length, o.length);
        for (let i = 0; i < n; i++)
        {
            const a = this.Items[i];
            const b = o[i];
            if (a === undefined || b === undefined) continue;
            const c = CypherValue.Compare(a, b);
            if (c !== 0) return c;
        }
        return this.Items.length - o.length;
    }
}

export class MapValue extends CypherValue
{
    private static readonly GroupKeyPrefix = "map:";
    private static readonly MapRank = 5;

    constructor(public readonly Entries: ReadonlyMap<string, CypherValue>)
    {
        super();
    }

    public Get(key: string): CypherValue | undefined
    {
        return this.Entries.get(key);
    }

    public ToDto(): CypherValueDto
    {
        const out: { [k: string]: CypherValueDto } = {};
        for (const [k, v] of this.Entries)
        {
            out[k] = v.ToDto();
        }
        return out;
    }

    public GroupKey(): string
    {
        const entries = this.SortedKeys().map(k => [k, this.Entries.get(k)?.GroupKey() ?? ""]);
        return MapValue.GroupKeyPrefix + JSON.stringify(entries);
    }

    protected TypeRank(): number
    {
        return MapValue.MapRank;
    }

    protected CompareSameType(other: CypherValue): number
    {
        const o = other as MapValue;
        const ka = this.SortedKeys();
        const kb = o.SortedKeys();
        const n = Math.min(ka.length, kb.length);
        for (let i = 0; i < n; i++)
        {
            const a = ka[i];
            const b = kb[i];
            if (a === undefined || b === undefined) continue;
            if (a < b) return -1;
            if (a > b) return 1;
            const va = this.Entries.get(a);
            const vb = o.Entries.get(b);
            if (va === undefined || vb === undefined) continue;
            const c = CypherValue.Compare(va, vb);
            if (c !== 0) return c;
        }
        return ka.length - kb.length;
    }

    private SortedKeys(): string[]
    {
        return [...this.Entries.keys()].sort();
    }
}

export class RelValue extends CypherValue
{
    private static readonly GroupKeyPrefix = "rel:";
    private static readonly RelRank = 6;

    constructor(
        public readonly FromId: string,
        public readonly Type: string,
        public readonly ToId: string)
    {
        super();
    }

    public ToDto(): CypherValueDto
    {
        return this.ToRelDto();
    }

    public ToRelDto(): RelDto
    {
        return { from: this.FromId, type: this.Type, to: this.ToId };
    }

    public GroupKey(): string
    {
        return RelValue.GroupKeyPrefix + JSON.stringify([this.FromId, this.Type, this.ToId]);
    }

    protected TypeRank(): number
    {
        return RelValue.RelRank;
    }

    protected CompareSameType(other: CypherValue): number
    {
        const a = this.GroupKey();
        const b = (other as RelValue).GroupKey();
        if (a < b) return -1;
        if (a > b) return 1;
        return 0;
    }
}

export class PathValue extends CypherValue
{
    private static readonly GroupKeyPrefix = "path:";
    private static readonly PathRank = 7;

    // Invariant for real paths: Nodes.length === Rels.length + 1.
    constructor(
        public readonly Nodes: readonly NodeValue[],
        public readonly Rels: readonly RelValue[])
    {
        super();
    }

    public Length(): number
    {
        return this.Rels.length;
    }

    public ToDto(): CypherValueDto
    {
        return {
            nodes: this.Nodes.map(n => n.ToDto()),
            relationships: this.Rels.map(r => r.ToRelDto())
        };
    }

    public GroupKey(): string
    {
        return PathValue.GroupKeyPrefix + JSON.stringify({ n: this.Nodes.map(n => n.GroupKey()), r: this.Rels.map(r => r.GroupKey()) });
    }

    protected TypeRank(): number
    {
        return PathValue.PathRank;
    }

    protected CompareSameType(other: CypherValue): number
    {
        const a = this.GroupKey();
        const b = (other as PathValue).GroupKey();
        if (a < b) return -1;
        if (a > b) return 1;
        return 0;
    }
}
