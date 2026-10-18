import type { CypherValue } from "./values.js";

export class Binding
{
    constructor(private readonly values: ReadonlyMap<string, CypherValue> = new Map())
    {
    }

    public Get(variable: string): CypherValue | undefined
    {
        return this.values.get(variable);
    }

    public With(variable: string, value: CypherValue): Binding
    {
        const next = new Map(this.values);
        next.set(variable, value);
        return new Binding(next);
    }

    public MapValues(map: (value: CypherValue) => CypherValue): Binding
    {
        const next = new Map<string, CypherValue>();
        for (const [variable, value] of this.values)
        {
            next.set(variable, map(value));
        }
        return new Binding(next);
    }

    /** Overlays other onto this; undefined when a shared variable holds different values (by GroupKey). */
    public Merge(other: Binding): Binding | undefined
    {
        const next = new Map(this.values);
        for (const [variable, value] of other.values)
        {
            const existing = next.get(variable);
            if (existing !== undefined && existing.GroupKey() !== value.GroupKey())
            {
                return undefined;
            }
            next.set(variable, value);
        }
        return new Binding(next);
    }
}

export class EvalContext
{
    constructor(public readonly Binding: Binding, public readonly Parameters: ReadonlyMap<string, CypherValue>)
    {
    }
}
