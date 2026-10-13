import type { Scalar } from "../manifest/logical.js";
import type { IGraphQuery } from "../graph-api/index.js";
import type { ICypherGraph } from "./graph.js";
import { GraphQueryAdapter } from "./graph.js";
import { CypherParser } from "./parser.js";
import { CypherQuery } from "./fluent.js";
import { LogicalPlanner } from "./planner.js";
import { CypherValue, NullValue } from "./values.js";
import { CypherResult } from "./result.js";
import type { CypherResultDto } from "./result.js";

export class CypherEngine
{
    private static readonly EmptyParams: ReadonlyMap<string, Scalar> = new Map();

    constructor(private readonly graph: ICypherGraph)
    {
    }

    public static OverQuery(query: IGraphQuery): CypherEngine
    {
        return new CypherEngine(new GraphQueryAdapter(query));
    }

    public Execute(source: string | CypherQuery, parameters: ReadonlyMap<string, Scalar> = CypherEngine.EmptyParams): CypherResult
    {
        const model = typeof source === "string" ? new CypherParser(source).Parse() : source.ToModel();
        const plan = new LogicalPlanner(this.graph, parameters).Plan(model);
        const columns = model.Return.Items.map((i) => i.ColumnName());
        const rows: CypherValue[][] = [];
        for (const binding of plan.Rows())
        {
            rows.push(columns.map((c) => binding.Get(c) ?? NullValue.Instance));
        }
        return new CypherResult(columns, rows);
    }

    public static ToDto(result: CypherResult): CypherResultDto
    {
        return {
            Columns: [...result.Columns],
            Rows: result.Rows.map((row) => row.map((v) => v.ToDto())),
        };
    }
}
