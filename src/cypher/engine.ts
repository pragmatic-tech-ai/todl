import type { IGraphQuery } from "../graph-api/index.js";
import type { ICypherGraph } from "./graph.js";
import { GraphQueryAdapter } from "./graph.js";
import { CypherParser } from "./parser.js";
import { CypherQuery } from "./fluent.js";
import { LogicalPlanner } from "./planner.js";
import type { IOperator } from "./operators.js";
import { BindingRows } from "./operators.js";
import { ListValue, MapValue } from "./values-structured.js";
import type { ICypherWriter } from "./writer.js";
import type { Binding } from "./binding.js";
import type { PlannerOptions } from "./planner.js";
import { CypherValue, NodeRefValue, NodeValue, NullValue } from "./values.js";
import type { ParameterValue } from "./values.js";
import { ParameterBinder } from "./parameter-binder.js";
import { CypherResult } from "./result.js";
import type { CypherResultDto } from "./result.js";
import { CancelProbe } from "./execution-limits.js";
import type { CypherQueryModel } from "./query-model.js";
import { CypherSemanticError } from "./errors.js";
import type { ExecutionLimits } from "./execution-limits.js";

export class CypherEngine
{
    private static readonly EmptyParams: ReadonlyMap<string, ParameterValue> = new Map();
    private static readonly InvalidSkip = "paging Skip must be a non-negative integer";
    private static readonly InvalidPageSize = "paging RowCap must be a positive integer when Skip is supplied";

    private static readonly WritesRequireWriter = "write clauses require an ICypherWriter; this engine was built without one";

    constructor(private readonly graph: ICypherGraph, private readonly options?: PlannerOptions, private readonly writer?: ICypherWriter)
    {
    }

    public static OverQuery(query: IGraphQuery, options?: PlannerOptions): CypherEngine
    {
        return new CypherEngine(new GraphQueryAdapter(query), options);
    }

    public Execute(source: string | CypherQuery, parameters: ReadonlyMap<string, ParameterValue> = CypherEngine.EmptyParams, limits?: ExecutionLimits): CypherResult
    {
        const model = typeof source === "string" ? new CypherParser(source).Parse() : source.ToModel();
        if (model.HasWrites())
        {
            return this.ExecuteWrite(model, parameters, limits);
        }
        const paging = limits?.Skip !== undefined;
        if (paging) CypherEngine.ValidatePaging(limits!);
        const plan = new LogicalPlanner(this.graph, ParameterBinder.FromInputMap(parameters), this.options, limits?.Cancel, paging).Plan(model);
        const columns = model.FinalColumns();
        return paging ? this.Page(plan, columns, limits!) : this.Collect(plan, columns, limits);
    }

    // Two phases: (1) drain the mutating pipeline eagerly (a write is never paged or truncated), commit, then
    // (2) re-resolve node references against the committed graph and run the final projection over the full stream.
    private ExecuteWrite(model: CypherQueryModel, parameters: ReadonlyMap<string, ParameterValue>, limits?: ExecutionLimits): CypherResult
    {
        if (this.writer === undefined) throw new CypherSemanticError(CypherEngine.WritesRequireWriter);
        const writer = this.writer;
        // Writes are never paged: ValidatePaging is intentionally skipped and limits.Skip/RowCap are ignored for the apply drain.
        writer.Begin();
        // The try intentionally covers the post-commit projection too, so ANY throw (incl. an ORDER BY/type error in the
        // projection) rolls back; this relies on ICypherWriter.Rollback() remaining valid after Commit().
        try
        {
            const binder = ParameterBinder.FromInputMap(parameters);
            const { Mutations, Projection } = new LogicalPlanner(this.graph, binder, this.options, limits?.Cancel, false, writer).PlanForWrite(model);
            const probe = new CancelProbe(limits?.Cancel);
            const raw: Binding[] = [];
            for (const binding of Mutations.Rows())
            {
                probe.Tick();
                raw.push(binding);
            }
            const committed = writer.Commit();
            let columns: readonly string[] = [];
            const rows: CypherValue[][] = [];
            if (Projection !== undefined)
            {
                const resolved = raw.map((b) => b.MapValues((v) => CypherEngine.Resolve(committed, v)));
                columns = model.FinalColumns();
                const projected = new LogicalPlanner(committed, binder, this.options, limits?.Cancel, false).ProjectOver(new BindingRows(resolved), Projection);
                for (const binding of projected.Rows())
                {
                    probe.Tick();
                    rows.push(CypherEngine.Materialize(binding, columns));
                }
            }
            return new CypherResult(columns, rows, false, false, writer.Stats());
        }
        catch (e)
        {
            try
            {
                writer.Rollback();
            }
            catch
            {
                // A failed rollback must not mask the original error.
            }
            throw e;
        }
    }

    private static Resolve(graph: ICypherGraph, value: CypherValue): CypherValue
    {
        if (value instanceof NodeValue || value instanceof NodeRefValue)
        {
            const mirror = graph.Reflect(value.Id);
            return mirror === undefined ? NullValue.Instance : new NodeValue(mirror);
        }
        if (value instanceof ListValue)
        {
            return new ListValue(value.Items.map((i) => CypherEngine.Resolve(graph, i)));
        }
        if (value instanceof MapValue)
        {
            const entries = new Map<string, CypherValue>();
            for (const [k, v] of value.Entries) entries.set(k, CypherEngine.Resolve(graph, v));
            return new MapValue(entries);
        }
        return value;
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
            if (rows.length >= limits.RowCap!)
            {
                hasMore = true;
                break;
            }
            rows.push(CypherEngine.Materialize(binding, columns));
        }
        return new CypherResult(columns, rows, false, hasMore);
    }

    // Paging limits are fail-fast: a bad Skip must not silently act as 0, and Skip without a page size is a misuse.
    private static ValidatePaging(limits: ExecutionLimits): void
    {
        if (!Number.isInteger(limits.Skip) || limits.Skip! < 0) throw new CypherSemanticError(`${CypherEngine.InvalidSkip}: ${limits.Skip}`);
        if (!Number.isInteger(limits.RowCap) || limits.RowCap! <= 0) throw new CypherSemanticError(`${CypherEngine.InvalidPageSize}: ${limits.RowCap}`);
    }

    private static Materialize(binding: Binding, columns: readonly string[]): CypherValue[]
    {
        return columns.map((c) => binding.Get(c) ?? NullValue.Instance);
    }

    public static ToDto(result: CypherResult): CypherResultDto
    {
        const dto: CypherResultDto = {
            Columns: [...result.Columns],
            Rows: result.Rows.map((row) => row.map((v) => v.ToDto())),
            Truncated: result.Truncated,
            HasMore: result.HasMore,
        };
        if (result.Stats !== undefined)
        {
            dto.Stats = result.Stats.ToDto();
        }
        return dto;
    }
}
