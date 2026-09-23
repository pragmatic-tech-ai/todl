// The reflection analog of EntityBase (SP3): a typed read lens over one reflected
// instance or taxonomy term. Scalars come from the reflection FieldView; references
// are resolved to sibling entities through the identity-mapped host (ReflectedRepository).

import type { InstanceMirror, TermInfo } from "../manifest/reflection/reflection.js";
import type { Scalar } from "../manifest/logical.js";

/** The read source behind a ReflectedEntity: a heap instance or a taxonomy term. */
export interface EntityReader
{
    readonly id: string;
    readonly concept: string;
    field(name: string): Scalar | undefined;
    targets(member: string): readonly string[];
}

/** The identity-mapped entity resolver a ReflectedEntity follows refs through. */
export interface EntityHost
{
    entity(id: string): ReflectedEntity | undefined;
}

/** A read lens over one reflected instance/term — the reflection analog of EntityBase. */
export class ReflectedEntity
{
    constructor(protected readonly repo: EntityHost, private readonly reader: EntityReader)
    {
    }

    public get id(): string
    {
        return this.reader.id;
    }

    public get concept(): string
    {
        return this.reader.concept;
    }

    protected field(name: string): Scalar | undefined
    {
        return this.reader.field(name);
    }

    protected ref(member: string): ReflectedEntity | undefined
    {
        const [first] = this.reader.targets(member);
        return first === undefined ? undefined : this.repo.entity(first);
    }

    protected refs(member: string): readonly ReflectedEntity[]
    {
        const out: ReflectedEntity[] = [];
        for (const id of this.reader.targets(member))
        {
            const e = this.repo.entity(id);
            if (e !== undefined) out.push(e);
        }
        return out;
    }
}

/** An EntityReader over a heap instance. */
export class MirrorReader implements EntityReader
{
    constructor(private readonly mirror: InstanceMirror)
    {
    }

    public get id(): string
    {
        return this.mirror.node.id;
    }

    public get concept(): string
    {
        return this.mirror.node.type;
    }

    public field(name: string): Scalar | undefined
    {
        return this.mirror.field(name)?.value;
    }

    public targets(member: string): readonly string[]
    {
        // Read the flattened edge targets directly: both true relationships and
        // concept-typed reference FIELDS materialise into node.refs, and only some
        // are declared in getRelationships() — node.refs is the uniform source.
        return this.mirror.node.refs?.[member] ?? [];
    }
}

/** An EntityReader over a taxonomy term (fixed scalar values; term ref-fixing out of scope). */
export class TermReader implements EntityReader
{
    constructor(private readonly term: TermInfo)
    {
    }

    public get id(): string
    {
        return this.term.id;
    }

    public get concept(): string
    {
        return this.term.concept?.name ?? "";
    }

    public field(name: string): Scalar | undefined
    {
        const field = this.term.concept?.getField(name);
        return field === undefined ? undefined : this.term.getFixedValue(field);
    }

    public targets(): readonly string[]
    {
        return [];
    }
}
