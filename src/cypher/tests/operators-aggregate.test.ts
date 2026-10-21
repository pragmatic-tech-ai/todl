import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Aggregate } from "../operators-aggregate.js";
import type { IOperator } from "../operators.js";
import { Binding } from "../binding.js";
import { ScalarValue } from "../values.js";
import { ReturnItem } from "../query-model.js";
import { VariableRef, FunctionCall } from "../expressions.js";
import { ListValue } from "../values-structured.js";

class Rows implements IOperator
{
    constructor(private readonly rows: Binding[])
    {
    }

    public *Rows(): Iterable<Binding>
    {
        yield* this.rows;
    }

    public static Row(kind: string, x: number): Binding
    {
        return new Binding().With("k", new ScalarValue(kind)).With("x", new ScalarValue(x));
    }
}

class Fixtures
{
    public static readonly K = "k";
    public static readonly X = "x";
    public static readonly Count = "c";
    public static readonly Xs = "xs";

    public static Grouping(): ReturnItem[]
    {
        return [new ReturnItem(new VariableRef(Fixtures.K), Fixtures.K)];
    }

    public static CountStar(): { Column: string; Call: FunctionCall }
    {
        return { Column: Fixtures.Count, Call: new FunctionCall("count", [], false, true) };
    }

    public static Collect(distinct: boolean): { Column: string; Call: FunctionCall }
    {
        return { Column: Fixtures.Xs, Call: new FunctionCall("collect", [new VariableRef(Fixtures.X)], distinct, false) };
    }
}

describe("Aggregate operator", () =>
{
    test("group by k, count(*) and collect(x)", () =>
    {
        const src = new Rows([Rows.Row("a", 1), Rows.Row("a", 2), Rows.Row("b", 3)]);
        const out = [...new Aggregate(src, Fixtures.Grouping(), [Fixtures.CountStar(), Fixtures.Collect(false)], new Map()).Rows()];
        assert.equal(out.length, 2);
        assert.equal((out[0]!.Get("k") as ScalarValue).Value, "a");
        const byK = new Map(out.map((r) => [(r.Get("k") as ScalarValue).Value, r]));
        assert.equal((byK.get("a")!.Get("c") as ScalarValue).Value, 2);
        assert.equal((byK.get("b")!.Get("c") as ScalarValue).Value, 1);
        assert.ok(byK.get("a")!.Get("xs") instanceof ListValue);
    });

    test("DISTINCT aggregate dedups within a group", () =>
    {
        const src = new Rows([Rows.Row("a", 1), Rows.Row("a", 1), Rows.Row("a", 2), Rows.Row("b", 1)]);
        const out = [...new Aggregate(src, Fixtures.Grouping(), [Fixtures.Collect(true)], new Map()).Rows()];
        const a = out[0]!.Get("xs") as ListValue;
        const b = out[1]!.Get("xs") as ListValue;
        assert.equal(a.Items.length, 2);
        assert.equal(b.Items.length, 1);
    });

    test("group keys are collision-safe", () =>
    {
        const two = new ReturnItem(new VariableRef("x"), "x");
        const src = new Rows([
            new Binding().With("k", new ScalarValue("a|b")).With("x", new ScalarValue("c")),
            new Binding().With("k", new ScalarValue("a")).With("x", new ScalarValue("b|c")),
        ]);
        const out = [...new Aggregate(src, [...Fixtures.Grouping(), two], [Fixtures.CountStar()], new Map()).Rows()];
        assert.equal(out.length, 2);
    });

    test("empty input without grouping yields one row of empty results", () =>
    {
        const out = [...new Aggregate(new Rows([]), [], [Fixtures.CountStar()], new Map()).Rows()];
        assert.equal(out.length, 1);
        assert.equal((out[0]!.Get("c") as ScalarValue).Value, 0);
    });

    test("empty input with grouping yields no rows", () =>
    {
        const out = [...new Aggregate(new Rows([]), Fixtures.Grouping(), [Fixtures.CountStar()], new Map()).Rows()];
        assert.equal(out.length, 0);
    });

    test("groups emit in first-seen order, not sorted order", () =>
    {
        const src = new Rows([Rows.Row("z", 1), Rows.Row("a", 2), Rows.Row("m", 3), Rows.Row("a", 4), Rows.Row("z", 5)]);
        const out = [...new Aggregate(src, Fixtures.Grouping(), [Fixtures.CountStar(), Fixtures.Collect(false)], new Map()).Rows()];
        assert.deepEqual(out.map((r) => (r.Get("k") as ScalarValue).Value), ["z", "a", "m"]);
        assert.deepEqual(out.map((r) => (r.Get("c") as ScalarValue).Value), [2, 2, 1]);
        const xs = (r: Binding) => (r.Get("xs") as ListValue).Items.map((i) => (i as ScalarValue).Value);
        assert.deepEqual(xs(out[0]!), [1, 5]);
        assert.deepEqual(xs(out[1]!), [2, 4]);
        assert.deepEqual(xs(out[2]!), [3]);
    });
});
