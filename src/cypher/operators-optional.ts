import type { IOperator } from "./operators.js";
import type { Binding } from "./binding.js";
import { NullValue } from "./values.js";

export class OptionalApply implements IOperator
{
    constructor(
        private readonly child: IOperator,
        private readonly buildOptional: (row: Binding) => IOperator,
        private readonly optionalVars: readonly string[],
    )
    {
    }

    public *Rows(): Iterable<Binding>
    {
        for (const row of this.child.Rows())
        {
            let matched = false;
            for (const out of this.buildOptional(row).Rows())
            {
                matched = true;
                yield out;
            }
            if (!matched)
            {
                let padded = row;
                for (const name of this.optionalVars)
                {
                    padded = padded.With(name, NullValue.Instance);
                }
                yield padded;
            }
        }
    }
}
