import { test } from "node:test";
import assert from "node:assert/strict";
import { VariableRef, Literal, PropertyAccess } from "../expressions.js";
import { NodePattern, PatternPath } from "../patterns.js";
import {
    MatchClause, WhereClause, UnwindClause, ReadingClause, SortItem, ProjectionClause, QueryPart, ReturnItem,
} from "../query-model.js";

class QueryModelSp2Fixture
{
    public static Path(): PatternPath
    {
        return new PatternPath([new NodePattern("n", "Person", new Map())], []);
    }
}

test("MatchClause stays backward compatible", () =>
{
    const m = new MatchClause([QueryModelSp2Fixture.Path()]);
    assert.equal(m.Where, undefined);
    assert.equal(m.Optional, false);
    assert.ok(m instanceof ReadingClause);
});

test("QueryPart composes reading clauses and projection", () =>
{
    const where = new WhereClause(new VariableRef("n"));
    const match = new MatchClause([QueryModelSp2Fixture.Path()], where, true);
    const unwind = new UnwindClause(new Literal(1), "x");
    const sort = new SortItem(new PropertyAccess("n", "name"), true);
    const skip = new Literal(1);
    const limit = new Literal(5);
    const proj = new ProjectionClause([new ReturnItem(new VariableRef("n"), undefined)], true, [sort], skip, limit, true);
    const part = new QueryPart([match, unwind], proj);

    assert.equal(match.Where, where);
    assert.equal(match.Optional, true);
    assert.equal(unwind.Variable, "x");
    assert.ok(unwind instanceof ReadingClause);
    assert.equal(sort.Descending, true);
    assert.equal(part.Reading.length, 2);
    assert.equal(part.Projection.Distinct, true);
    assert.equal(part.Projection.OrderBy?.[0], sort);
    assert.equal(part.Projection.Skip, skip);
    assert.equal(part.Projection.Limit, limit);
    assert.equal(part.Projection.IsReturn, true);
});
