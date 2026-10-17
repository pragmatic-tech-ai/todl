import type { IGraphQuery } from "../graph-api/index.js";
import type { ICypherGraph } from "./graph.js";
import { GraphQueryAdapter } from "./graph.js";
import { CypherParser } from "./parser.js";
import { CypherQuery } from "./fluent.js";
import { LogicalPlanner } from "./planner.js";
import type { IOperator } from "./operators.js";
import type { Binding } from "./binding.js";
import type { PlannerOptions } from "./planner.js";
import { CypherValue, NullValue } from "./values.js";
import type { ParameterValue } from "./values.js";
import { ParameterBinder } from "./parameter-binder.js";
import { CypherResult } from "./result.js";
import type { CypherResultDto } from "./result.js";
import { CancelProbe } from "./execution-limits.js";
import type { ExecutionLimits } from "./execution-limits.js";

export class CypherEngine
{
    private static readonly EmptyParams: ReadonlyMap<string, ParameterValue> = new Map();

    constructor(private readonly graph: ICypherGraph, private readonly options?: PlannerOptions)
    {
    }

    public static OverQuery(query: IGraphQuery, options?: PlannerOptions): CypherEngine
    {
        return new CypherEngine(new GraphQueryAdapter(query), options);
    }

    public Execute(source: string | CypherQuery, parameters: ReadonlyMap<string, ParameterValue> = CypherEngine.EmptyParams, limits?: ExecutionLimits): CypherResult
    {
        const model = typeof source === "string" ? new CypherParser(source).Parse() : source.ToModel();
        const paging = limits?.Skip !== undefined;
        const plan = new LogicalPlanner(this.graph, ParameterBinder.FromInputMap(parameters), this.options, limits?.Cancel, paging).Plan(model);
        const columns = model.FinalColumns();
        return paging ? this.Page(plan, columns, limits!) : this.Collect(plan, columns, limits);
    }

    private Collect(plan: IOperator, columns: readonly string[], limits?: ExecutionLimits): CypherResult
    {
        const rows: CypherValue[][] = [];
        let truncated = false;
        const probe = new CancelProbe(limits?.Cancel);
        for (const binding of plan.Rows())
        {
            probe.Tick();
            if (limits?.RowCap !== undefined && rows.length >= limits.RowCap)
            {
                truncated = true;
                break;
            }
            rows.push(CypherEngine.Materialize(binding, columns));
        }
        return new CypherResult(columns, rows, truncated);
    }

    // Paging: discard the first Skip bindings without materializing them, collect up to RowCap rows, then peek exactly
    // one further binding to report HasMore. Truncated is never set on a page.
    private Page(plan: IOperator, columns: readonly string[], limits: ExecutionLimits): CypherResult
    {
        const skip = limits.Skip!;
        const rows: CypherValue[][] = [];
        let skipped = 0;
        let hasMore = false;
        const probe = new CancelProbe(limits.Cancel);
        for (const binding of plan.Rows())
        {
            probe.Tick();
            if (skipped < skip)
            {
                skipped++;
                continue;
            }
            if (limits.RowCap !== undefined && rows.length >= limits.RowCap)
            {
                hasMore = true;
                break;
            }
            rows.push(CypherEngine.Materialize(binding, columns));
        }
        return new CypherResult(columns, rows, false, hasMore);
    }

    private static Materialize(binding: Binding, columns: readonly string[]): CypherValue[]
    {
        return columns.map((c) => binding.Get(c) ?? NullValue.Instance);
    }

    public static ToDto(result: CypherResult): CypherResultDto
    {
        return {
            Columns: [...result.Columns],
            Rows: result.Rows.map((row) => row.map((v) => v.ToDto())),
            Truncated: result.Truncated,
            HasMore: result.HasMore,
        };
    }
}
