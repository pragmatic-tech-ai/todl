import type { Expression, PropertyAccess } from "./expressions.js";
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

// Marker base for clauses that mutate the graph. A WritingClause IS-A ReadingClause so it flows through QueryPart.Reading.
export abstract class WritingClause extends ReadingClause
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

export class CreateClause extends WritingClause
{
    constructor(public readonly Paths: readonly PatternPath[])
    {
        super();
    }

    public DeclaredVariables(): string[]
    {
        return WritingPatterns.Variables(this.Paths);
    }
}

export class MergeClause extends WritingClause
{
    constructor(public readonly Pattern: PatternPath)
    {
        super();
    }

    public DeclaredVariables(): string[]
    {
        return WritingPatterns.Variables([this.Pattern]);
    }
}

export enum SetMode
{
    Property,
    MergeMap,
}

export class SetItem
{
    constructor(
        public readonly Variable: string,
        // Defined for "n.p = expr" (SetMode.Property); undefined for "n += map" (SetMode.MergeMap).
        public readonly Property: string | undefined,
        public readonly Value: Expression,
        public readonly Mode: SetMode,
    )
    {
    }
}

export class SetClause extends WritingClause
{
    constructor(public readonly Items: readonly SetItem[])
    {
        super();
    }
}

export class DeleteClause extends WritingClause
{
    constructor(public readonly Targets: readonly Expression[], public readonly Detach: boolean)
    {
        super();
    }
}

export class RemoveClause extends WritingClause
{
    constructor(public readonly Items: readonly PropertyAccess[])
    {
        super();
    }
}

class WritingPatterns
{
    public static Variables(paths: readonly PatternPath[]): string[]
    {
        const out: string[] = [];
        for (const path of paths)
        {
            for (const n of path.Nodes) if (n.Variable !== undefined) out.push(n.Variable);
            for (const r of path.Rels) if (r.Variable !== undefined) out.push(r.Variable);
        }
        return out;
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
    constructor(public readonly Reading: readonly ReadingClause[], public readonly Projection: ProjectionClause | undefined = undefined)
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
        // Parse/fluent invariants guarantee at least one part; a write-only final part has no projection.
        const last = this.Parts[this.Parts.length - 1]!;
        if (last.Projection === undefined) return [];
        return last.Projection.Items.map((i) => i.ColumnName());
    }

    public HasWrites(): boolean
    {
        return this.Parts.some((p) => p.Reading.some((c) => c instanceof WritingClause));
    }
}
