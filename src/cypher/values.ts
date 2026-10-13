import type { Scalar } from "../manifest/logical.js";
import type { InstanceMirror } from "../manifest/reflection/reflection.js";
import type { EntityReader, EntityHost } from "../reflection-client/index.js";
import { ReflectedEntity, MirrorReader } from "../reflection-client/index.js";
import { Snapshot, type MirrorSnapshot } from "../graph-api/index.js";

export type CypherValueDto = MirrorSnapshot | Scalar | null | CypherValueDto[] | { [k: string]: CypherValueDto };

export abstract class CypherValue
{
    public abstract ToDto(): CypherValueDto;
    public abstract GroupKey(): string;

    // Total order; nulls sort last for ascending. Cross-type by TypeRank, then within-type.
    public static Compare(a: CypherValue, b: CypherValue): number
    {
        const ra = a.TypeRank();
        const rb = b.TypeRank();
        if (ra !== rb) return ra - rb;
        return a.CompareSameType(b);
    }

    protected abstract TypeRank(): number;
    protected abstract CompareSameType(other: CypherValue): number;
}

export class ScalarValue extends CypherValue
{
    constructor(public readonly Value: Scalar)
    {
        super();
    }

    public ToDto(): CypherValueDto
    {
        return this.Value;
    }

    public GroupKey(): string
    {
        return `${typeof this.Value}:${String(this.Value)}`;
    }

    protected TypeRank(): number
    {
        if (typeof this.Value === "number") return 0;
        if (typeof this.Value === "string") return 1;
        return 2;
    }

    protected CompareSameType(other: CypherValue): number
    {
        const o = (other as ScalarValue).Value;
        if (this.Value < o) return -1;
        if (this.Value > o) return 1;
        return 0;
    }
}

export class NullValue extends CypherValue
{
    private static readonly GroupKeyText = "null";
    private static readonly NullRank = 100;
    public static readonly Instance = new NullValue();

    private constructor()
    {
        super();
    }

    public ToDto(): CypherValueDto
    {
        return null;
    }

    public GroupKey(): string
    {
        return NullValue.GroupKeyText;
    }

    protected TypeRank(): number
    {
        return NullValue.NullRank;
    }

    protected CompareSameType(): number
    {
        return 0;
    }
}

export class NodeValue extends CypherValue
{
    private static readonly GroupKeyPrefix = "node:";
    private static readonly NodeRank = 3;

    constructor(private readonly mirror: InstanceMirror)
    {
        super();
    }

    public get Id(): string
    {
        return this.mirror.node.id;
    }

    public get Concept(): string
    {
        return this.mirror.type.fullName;
    }

    public Field(name: string): Scalar | undefined
    {
        return this.mirror.field(name)?.value;
    }

    public Reader(): EntityReader
    {
        return new MirrorReader(this.mirror);
    }

    public AsEntity(host: EntityHost): ReflectedEntity
    {
        return new ReflectedEntity(host, this.Reader());
    }

    public ToDto(): CypherValueDto
    {
        return Snapshot.of(this.mirror);
    }

    public GroupKey(): string
    {
        return `${NodeValue.GroupKeyPrefix}${this.Id}`;
    }

    protected TypeRank(): number
    {
        return NodeValue.NodeRank;
    }

    protected CompareSameType(other: CypherValue): number
    {
        const o = (other as NodeValue).Id;
        if (this.Id < o) return -1;
        if (this.Id > o) return 1;
        return 0;
    }
}
