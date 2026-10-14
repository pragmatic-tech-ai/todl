import type { ICypherGraph } from "./graph.js";
import type { Expression } from "./expressions.js";
import type { ReturnItem } from "./query-model.js";
import { Binding, EvalContext } from "./binding.js";
import { CypherValue, NodeValue } from "./values.js";
import { RelValue } from "./values-structured.js";
import { BooleanExpression } from "./expressions.js";
import { RelDirection } from "./enums.js";

export interface IOperator
{
    Rows(): Iterable<Binding>;
}

export class AllNodesScan implements IOperator
{
    constructor(private readonly graph: ICypherGraph, private readonly variable: string)
    {
    }

    public *Rows(): Iterable<Binding>
    {
        for (const m of this.graph.AllInstances())
        {
            yield new Binding().With(this.variable, new NodeValue(m));
        }
    }
}

export class LabelScan implements IOperator
{
    constructor(private readonly graph: ICypherGraph, private readonly variable: string, private readonly label: string)
    {
    }

    public *Rows(): Iterable<Binding>
    {
        for (const m of this.graph.NodesByLabel(this.label))
        {
            yield new Binding().With(this.variable, new NodeValue(m));
        }
    }
}

// Single home for how a traversed edge is reported as a RelValue, shared by every expand operator so
// fixed and variable-length relationship variables agree. Outgoing walks current->next; Incoming walks
// against the edge, so the real edge is next->current. Undirected keeps traversal order (true undirected
// orientation needs edge-direction info Expand does not return; filed Feature).
export class RelOrientation
{
    public static readonly UntypedRel = "";

    public static Oriented(direction: RelDirection, relType: string | undefined, currentId: string, nextId: string): RelValue
    {
        const type = relType ?? RelOrientation.UntypedRel;
        return direction === RelDirection.Incoming ? new RelValue(nextId, type, currentId) : new RelValue(currentId, type, nextId);
    }
}

export class Expand implements IOperator
{
    constructor(
        private readonly child: IOperator,
        private readonly graph: ICypherGraph,
        private readonly fromVar: string,
        private readonly toVar: string,
        private readonly relType: string | undefined,
        private readonly direction: RelDirection,
        private readonly toLabel: string | undefined,
        private readonly relVar: string | undefined = undefined,
    )
    {
    }

    public *Rows(): Iterable<Binding>
    {
        for (const row of this.child.Rows())
        {
            const from = row.Get(this.fromVar);
            if (!(from instanceof NodeValue)) continue;
            for (const target of this.graph.Expand(from.Id, this.relType, this.direction))
            {
                if (this.toLabel !== undefined && !this.graph.IsInstanceOf(target, this.toLabel)) continue;
                const next = new NodeValue(target);
                const out = row.With(this.toVar, next);
                yield this.relVar === undefined ? out : out.With(this.relVar, RelOrientation.Oriented(this.direction, this.relType, from.Id, next.Id));
            }
        }
    }
}

// Expands from an already-bound source into an already-bound target, constraining the
// reached node to equal the target rather than rebinding it. Adds NO binding to the row:
// it yields the original row unchanged when the target is reachable over the relationship,
// so a reused target variable (converging joins, cycles) is constrained, never clobbered.
export class ExpandInto implements IOperator
{
    constructor(
        private readonly child: IOperator,
        private readonly graph: ICypherGraph,
        private readonly fromVar: string,
        private readonly toVar: string,
        private readonly relType: string | undefined,
        private readonly direction: RelDirection,
        private readonly relVar: string | undefined = undefined,
    )
    {
    }

    public *Rows(): Iterable<Binding>
    {
        for (const row of this.child.Rows())
        {
            const from = row.Get(this.fromVar);
            const to = row.Get(this.toVar);
            if (!(from instanceof NodeValue) || !(to instanceof NodeValue)) continue;
            for (const target of this.graph.Expand(from.Id, this.relType, this.direction))
            {
                if (new NodeValue(target).Id === to.Id)
                {
                    yield this.relVar === undefined ? row : row.With(this.relVar, RelOrientation.Oriented(this.direction, this.relType, from.Id, to.Id));
                    break;
                }
            }
        }
    }
}

// Keeps only rows whose bound variable is a node that is an instance of the label. Used for a label
// written on a REUSED variable occurrence, where no scan exists to apply it.
export class LabelFilter implements IOperator
{
    constructor(
        private readonly child: IOperator,
        private readonly graph: ICypherGraph,
        private readonly varName: string,
        private readonly label: string,
    )
    {
    }

    public *Rows(): Iterable<Binding>
    {
        for (const row of this.child.Rows())
        {
            const v = row.Get(this.varName);
            if (!(v instanceof NodeValue)) continue;
            const mirror = this.graph.Reflect(v.Id);
            if (mirror !== undefined && this.graph.IsInstanceOf(mirror, this.label)) yield row;
        }
    }
}

export class Filter implements IOperator
{
    constructor(private readonly child: IOperator, private readonly predicate: Expression, private readonly parameters: ReadonlyMap<string, CypherValue>)
    {
    }

    public *Rows(): Iterable<Binding>
    {
        for (const row of this.child.Rows())
        {
            const ctx = new EvalContext(row, this.parameters);
            if (BooleanExpression.Truthy(this.predicate.Evaluate(ctx))) yield row;
        }
    }
}

export class Project implements IOperator
{
    constructor(private readonly child: IOperator, private readonly items: readonly ReturnItem[], private readonly parameters: ReadonlyMap<string, CypherValue>)
    {
    }

    public *Rows(): Iterable<Binding>
    {
        for (const row of this.child.Rows())
        {
            const ctx = new EvalContext(row, this.parameters);
            let projected = new Binding();
            for (const item of this.items)
            {
                projected = projected.With(item.ColumnName(), item.Expr.Evaluate(ctx));
            }
            yield projected;
        }
    }
}

export class SingleRow implements IOperator
{
    public *Rows(): Iterable<Binding>
    {
        yield new Binding();
    }
}

export class BindingRow implements IOperator
{
    constructor(private readonly row: Binding)
    {
    }

    public *Rows(): Iterable<Binding>
    {
        yield this.row;
    }
}
