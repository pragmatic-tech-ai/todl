import type { IGraphQuery } from "../graph-api/index.js";
import type { ICypherGraph } from "./graph.js";
import { GraphQueryAdapter } from "./graph.js";
import { CypherParser } from "./parser.js";
import { CypherQuery } from "./fluent.js";
import { LogicalPlanner } from "./planner.js";
import type { PlannerOptions } from "./planner.js";
import { CypherValue, NullValue } from "./values.js";
import type { ParameterValue } from "./values.js";
import { ParameterBinder } from "./parameter-binder.js";
import { CypherResult } from "./result.js";
import type { CypherResultDto } from "./result.js";
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
        const plan = new LogicalPlanner(this.graph, ParameterBinder.FromInputMap(parameters), this.options).Plan(model);
        const columns = model.FinalColumns();
        const rows: CypherValue[][] = [];
        let truncated = false;
        for (const binding of plan.Rows())
        {
            if (limits?.RowCap !== undefined && rows.length >= limits.RowCap)
            {
                truncated = true;
                break;
            }
            rows.push(columns.map((c) => binding.Get(c) ?? NullValue.Instance));
        }
        return new CypherResult(columns, rows, truncated);
    }

    public static ToDto(result: CypherResult): CypherResultDto
    {
        return {
            Columns: [...result.Columns],
            Rows: result.Rows.map((row) => row.map((v) => v.ToDto())),
            Truncated: result.Truncated,
        };
    }
}
