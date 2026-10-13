import type { Scalar } from "../manifest/logical.js";
import type { MirrorSnapshot } from "../graph-api/index.js";
import type { EntityReader } from "./reflected-entity.js";

export class SnapshotReader implements EntityReader
{
    constructor(private readonly snapshot: MirrorSnapshot)
    {
    }

    public get id(): string
    {
        return this.snapshot.id;
    }

    public get concept(): string
    {
        return this.snapshot.concept;
    }

    public field(name: string): Scalar | undefined
    {
        return this.snapshot.fields[name]?.value;
    }

    public targets(member: string): readonly string[]
    {
        return this.snapshot.refs[member] ?? [];
    }

    public fieldNames(): readonly string[]
    {
        return Object.keys(this.snapshot.fields);
    }
}
