import type { Expression } from "./expressions.js";
import type { IOperator } from "./operators.js";
import { Binding, EvalContext } from "./binding.js";
import { CypherValue, NullValue } from "./values.js";
import { ListValue } from "./values-structured.js";

export class Unwind implements IOperator
{
    constructor(
        private readonly child: IOperator,
        private readonly expr: Expression,
        private readonly variable: string,
        private readonly parameters: ReadonlyMap<string, CypherValue>,
    )
    {
    }

    public *Rows(): Iterable<Binding>
    {
        for (const row of this.child.Rows())
        {
            const value = this.expr.Evaluate(new EvalContext(row, this.parameters));
            if (value instanceof NullValue)
            {
                continue;
            }
            if (value instanceof ListValue)
            {
                for (const item of value.Items)
                {
                    yield row.With(this.variable, item);
                }
            }
            else
            {
                yield row.With(this.variable, value);
            }
        }
    }
}
