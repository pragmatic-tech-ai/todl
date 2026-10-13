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

export class MatchClause
{
    constructor(public readonly Paths: readonly PatternPath[])
    {
    }
}

export class WhereClause
{
    constructor(public readonly Predicate: Expression)
    {
    }
}

export class ReturnClause
{
    constructor(public readonly Items: readonly ReturnItem[])
    {
    }
}

export class CypherQueryModel
{
    constructor(
        public readonly Match: MatchClause,
        public readonly Where: WhereClause | undefined,
        public readonly Return: ReturnClause,
    )
    {
    }

    public DeclaredVariables(): Set<string>
    {
        const out = new Set<string>();
        for (const path of this.Match.Paths)
        {
            for (const n of path.Nodes) if (n.Variable !== undefined) out.add(n.Variable);
            for (const r of path.Rels) if (r.Variable !== undefined) out.add(r.Variable);
        }
        return out;
    }
}
