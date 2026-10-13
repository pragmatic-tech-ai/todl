import type { Scalar } from "../manifest/logical.js";
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
}

export class EvalContext
{
    constructor(public readonly Binding: Binding, public readonly Parameters: ReadonlyMap<string, Scalar>)
    {
    }
}
