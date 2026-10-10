import { ExprKind, BinaryOp, type Expr } from "../predicate/ast.js";

/**
 * Normalizes one `same when` predicate into the sorted set of field names the two
 * candidates (`left`, `right`) must agree on, or null if the v1 shape is violated.
 * Valid: a conjunction of `Eq` comparisons, each `left.F == right.F` (either order)
 * with the SAME field F on both sides.
 */
export class MatchRuleNormalizer
{
    public static Normalize(expr: Expr, left: string, right: string): string[] | null
    {
        const fields = new Set<string>();
        if (!MatchRuleNormalizer.Collect(expr, left, right, fields))
        {
            return null;
        }
        if (fields.size === 0)
        {
            return null;
        }
        return [...fields].sort();
    }

    private static Collect(expr: Expr, left: string, right: string, out: Set<string>): boolean
    {
        if (expr.kind === ExprKind.Binary && expr.op === BinaryOp.And)
        {
            return MatchRuleNormalizer.Collect(expr.left, left, right, out)
                && MatchRuleNormalizer.Collect(expr.right, left, right, out);
        }
        if (expr.kind === ExprKind.Binary && expr.op === BinaryOp.Eq)
        {
            const l = MatchRuleNormalizer.Field(expr.left, left, right);
            const r = MatchRuleNormalizer.Field(expr.right, left, right);
            if (l === null || r === null)
            {
                return false;
            }
            if (l.variable === r.variable || l.field !== r.field)
            {
                return false;
            }
            out.add(l.field);
            return true;
        }
        return false;
    }

    private static Field(expr: Expr, left: string, right: string): { variable: string; field: string } | null
    {
        if (expr.kind !== ExprKind.Member || expr.target.kind !== ExprKind.Name)
        {
            return null;
        }
        const variable = expr.target.id;
        if (variable !== left && variable !== right)
        {
            return null;
        }
        return { variable, field: expr.member };
    }
}
