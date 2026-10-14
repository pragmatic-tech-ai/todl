import { CypherValue, ScalarValue, NullValue } from "./values.js";
import type { ParameterValue } from "./values.js";
import { CypherSemanticError } from "./errors.js";
import { ListValue, MapValue } from "./values-structured.js";

// Converts caller-supplied plain-JS parameter trees into the engine's internal CypherValue currency.
// Lives apart from CypherValue because ListValue/MapValue (values-structured.ts) import values.ts;
// a static on the abstract root would create an import cycle.
export class ParameterBinder
{
    private static readonly Unsupported = "unsupported parameter value: only scalars, null, arrays and plain objects are allowed";

    public static FromInput(value: ParameterValue | undefined): CypherValue
    {
        if (value === null || value === undefined) return NullValue.Instance;
        if (Array.isArray(value)) return new ListValue(value.map((v) => ParameterBinder.FromInput(v)));
        if (typeof value === "object")
        {
            const proto = Object.getPrototypeOf(value);
            if (proto !== Object.prototype && proto !== null) throw new CypherSemanticError(ParameterBinder.Unsupported);
            const entries = new Map<string, CypherValue>();
            for (const [k, v] of Object.entries(value)) entries.set(k, ParameterBinder.FromInput(v));
            return new MapValue(entries);
        }
        return new ScalarValue(value);
    }

    public static FromInputMap(parameters: ReadonlyMap<string, ParameterValue>): ReadonlyMap<string, CypherValue>
    {
        const out = new Map<string, CypherValue>();
        for (const [name, value] of parameters) out.set(name, ParameterBinder.FromInput(value));
        return out;
    }
}
