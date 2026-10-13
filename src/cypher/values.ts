import type { Scalar } from "../manifest/logical.js";
import type { InstanceMirror } from "../manifest/reflection/reflection.js";
import type { EntityReader, EntityHost } from "../reflection-client/index.js";
import { ReflectedEntity, MirrorReader } from "../reflection-client/index.js";
import { Snapshot, type MirrorSnapshot } from "../graph-api/index.js";

export type CypherValueDto = MirrorSnapshot | Scalar | null;

export abstract class CypherValue
{
    public abstract ToDto(): CypherValueDto;
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
}

export class NullValue extends CypherValue
{
    public static readonly Instance = new NullValue();

    private constructor()
    {
        super();
    }

    public ToDto(): CypherValueDto
    {
        return null;
    }
}

export class NodeValue extends CypherValue
{
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
}
