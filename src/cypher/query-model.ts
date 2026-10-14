import type { Expression } from "./expressions.js";
import type { PatternPath } from "./patterns.js";

export class ReturnItem
{
    constructor(public readonly Expr: Expression, public readonly Alias: string | undefined)
    {
    }

    public ColumnName(): string
    {
        return this.Alias ?? this.Expr.DefaultName();
    }
}

export abstract class ReadingClause
{
}

export class WhereClause
{
    constructor(public readonly Predicate: Expression)
    {
    }
}

export class MatchClause extends ReadingClause
{
    constructor(
        public readonly Paths: readonly PatternPath[],
        public readonly Where: WhereClause | undefined = undefined,
        public readonly Optional: boolean = false,
    )
    {
        super();
    }

    public DeclaredVariables(): Set<string>
    {
        const out = new Set<string>();
        for (const path of this.Paths)
        {
            if (path.PathVariable !== undefined) out.add(path.PathVariable);
            for (const n of path.Nodes) if (n.Variable !== undefined) out.add(n.Variable);
            for (const r of path.Rels) if (r.Variable !== undefined) out.add(r.Variable);
        }
        return out;
    }
}

export class UnwindClause extends ReadingClause
{
    constructor(public readonly Expr: Expression, public readonly Variable: string)
    {
        super();
    }
}

export class SortItem
{
    constructor(public readonly Expr: Expression, public readonly Descending: boolean)
    {
    }
}

export class ProjectionClause
{
    constructor(
        public readonly Items: readonly ReturnItem[],
        public readonly Distinct: boolean,
        public readonly OrderBy: readonly SortItem[] | undefined,
        public readonly Skip: Expression | undefined,
        public readonly Limit: Expression | undefined,
        public readonly IsReturn: boolean,
        // Post-projection filter (WITH ... WHERE); evaluated over the projected columns.
        public readonly Where: WhereClause | undefined = undefined,
    )
    {
    }
}

export class QueryPart
{
    constructor(public readonly Reading: readonly ReadingClause[], public readonly Projection: ProjectionClause)
    {
    }
}

export class CypherQueryModel
{
    constructor(public readonly Parts: readonly QueryPart[])
    {
    }

    public FinalColumns(): string[]
    {
        // Parse/fluent invariants guarantee at least one part whose final projection is a RETURN.
        const last = this.Parts[this.Parts.length - 1]!;
        return last.Projection.Items.map((i) => i.ColumnName());
    }
}
