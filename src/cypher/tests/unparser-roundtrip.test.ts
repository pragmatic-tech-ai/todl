import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { GraphQuery } from "../../graph-api/graph-query-engine.js";
import { FrozenGraph } from "../../domain/graph.js";
import { Manifest } from "../../manifest/reflection/reflection.js";
import { ManifestWriter } from "../../manifest/manifest-writer.js";
import type { LogicalManifest } from "../../manifest/logical.js";
import type { ReflectedNode } from "../../manifest/reflection/reflection.js";
import { CypherEngine } from "../engine.js";
import { CypherParser } from "../parser.js";
import { CypherQuery, Pattern, Expr, Return, Sort, Fn, Hops } from "../fluent.js";
import type { NodeBuilder } from "../fluent.js";
import { BooleanExpression, Comparison, IsNullExpression, InExpression, Literal, VariableRef, PropertyAccess } from "../expressions.js";
import { BooleanOp, ComparisonOp } from "../enums.js";
import type { ParameterValue } from "../values.js";

class RoundTripFixture
{
    private static readonly Format = "todl-manifest/1";
    private static readonly Root = "Element";
    private static readonly ServiceConcept = "Service";
    private static readonly Customer = "shop.Customer";
    private static readonly Calls = "calls";

    public static readonly Engine: CypherEngine = RoundTripFixture.Build();

    private static Build(): CypherEngine
    {
        const field = { type: "string", card: "?" } as const;
        const logical: LogicalManifest = {
            format: RoundTripFixture.Format, model: "rt", version: "1.0.0", root: RoundTripFixture.Root,
            concepts: {
                [RoundTripFixture.Root]: { extends: null, fields: {}, relationships: {}, invariants: [], annotations: [] },
                [RoundTripFixture.ServiceConcept]: {
                    extends: RoundTripFixture.Root,
                    fields: { name: field, kind: field, age: { type: "number", card: "?" } as const },
                    relationships: { [RoundTripFixture.Calls]: { targets: [RoundTripFixture.ServiceConcept], card: "*", annotations: [] } },
                    invariants: [], annotations: [],
                },
                [RoundTripFixture.Customer]: { extends: RoundTripFixture.Root, fields: { name: field }, relationships: {}, invariants: [], annotations: [] },
            },
            classes: {}, taxonomies: {},
        };
        const g = new FrozenGraph();
        const m = Manifest.load(ManifestWriter.fromLogical(logical).toJSON());
        g.PreRegister(m);
        g.Finalize(m);
        const nodes: ReflectedNode[] = [
            RoundTripFixture.ServiceNode("s1", "checkout", "api", 3),
            RoundTripFixture.ServiceNode("s2", "ledger", "core", -2),
            RoundTripFixture.ServiceNode("s3", "billing", "core", 7),
            RoundTripFixture.ServiceNode("s4", "audit", "api", 10),
            { id: "c1", type: RoundTripFixture.Customer, attrs: { name: "acme" } },
        ];
        const edges = [
            { from: "s1", rel: RoundTripFixture.Calls, to: "s2" },
            { from: "s2", rel: RoundTripFixture.Calls, to: "s3" },
            { from: "s3", rel: RoundTripFixture.Calls, to: "s1" },
            { from: "s3", rel: RoundTripFixture.Calls, to: "s4" },
        ];
        g.BindSeed({ nodes, edges }, { model: "rt", version: "1.0.0" });
        return CypherEngine.OverQuery(new GraphQuery(g));
    }

    private static ServiceNode(id: string, name: string, kind: string, age: number): ReflectedNode
    {
        return { id, type: RoundTripFixture.ServiceConcept, attrs: { name, kind, age } };
    }

    // Asserts execute-DTO parity between the fluent query and its text form, and that the text re-parses.
    public static Check(q: CypherQuery, params: ReadonlyMap<string, ParameterValue> = new Map()): string
    {
        const text = q.ToCypherText();
        const viaFluent = CypherEngine.ToDto(RoundTripFixture.Engine.Execute(q, params));
        const viaText = CypherEngine.ToDto(RoundTripFixture.Engine.Execute(text, params));
        assert.deepEqual(viaText, viaFluent, text);
        assert.doesNotThrow(() => new CypherParser(text).Parse(), text);
        return text;
    }

    public static Svc(variable: string): NodeBuilder
    {
        return Pattern.Node(variable).Label(RoundTripFixture.ServiceConcept);
    }
}

describe("CypherQuery.ToCypherText round trip", () =>
{
    const S = (v: string): NodeBuilder => RoundTripFixture.Svc(v);

    test("fixed-length MATCH + property predicate + RETURN alias", () =>
    {
        const q = CypherQuery.Match(S("a").Prop("kind", "api")).Where(Expr.Prop("a", "name").Eq("checkout")).Return(Return.Prop("a", "name", "n"));
        RoundTripFixture.Check(q);
    });

    test("qualified label emits :ns.Concept", () =>
    {
        const q = CypherQuery.Match(Pattern.Node("c").Label("shop.Customer")).Return(Return.Node("c"));
        const text = RoundTripFixture.Check(q);
        assert.match(text, /:shop\.Customer/);
    });

    test("OPTIONAL MATCH", () =>
    {
        const q = CypherQuery.Match(S("a")).OptionalMatch(Pattern.Node("a").Out("calls", S("b").Prop("kind", "api"))).Return(Return.Prop("a", "name"), Return.Prop("b", "name"));
        RoundTripFixture.Check(q);
    });

    test("relationship type + direction + rel variable", () =>
    {
        RoundTripFixture.Check(CypherQuery.Match(S("a").Out("calls", S("b"), undefined, "r")).Return(Return.Prop("a", "name"), Return.Node("r"), Return.Prop("b", "name")));
        RoundTripFixture.Check(CypherQuery.Match(S("a").In("calls", S("b"))).Return(Return.Prop("a", "name"), Return.Prop("b", "name")));
        RoundTripFixture.Check(CypherQuery.Match(S("a").Undirected("calls", S("b"))).Return(Return.Prop("a", "name"), Return.Prop("b", "name")));
    });

    test("variable-length hops and path variable", () =>
    {
        for (const h of [Hops.Range(1, 3), Hops.Any(), Hops.AtLeast(2), Hops.Exactly(2)])
        {
            RoundTripFixture.Check(CypherQuery.Match(S("a").Out("calls", S("b"), h).AsPath("p")).Return(Return.Node("p"), Return.Prop("b", "name")));
        }
    });

    test("WHERE boolean, comparison, IN, IS NULL", () =>
    {
        const a = Expr.Prop("a", "kind").Eq("api");
        const b = Expr.Prop("a", "age").Gt(2);
        const c = new Comparison(new PropertyAccess("a", "name"), ComparisonOp.Neq, new Literal("audit"));
        const mixed = new BooleanExpression(BooleanOp.Or, [
            new BooleanExpression(BooleanOp.And, [a, new BooleanExpression(BooleanOp.Not, [b])]),
            new BooleanExpression(BooleanOp.And, [c, new BooleanExpression(BooleanOp.Or, [a, b])]),
        ]);
        RoundTripFixture.Check(CypherQuery.Match(S("a")).Where(mixed).Return(Return.Prop("a", "name")));
        const inn = new InExpression(new PropertyAccess("a", "age"), [new Literal(3), new Literal(-2), new Literal(10)]);
        RoundTripFixture.Check(CypherQuery.Match(S("a")).Where(inn).Return(Return.Prop("a", "name")));
        RoundTripFixture.Check(CypherQuery.Match(S("a")).Where(new IsNullExpression(new PropertyAccess("a", "zzz"), true)).Return(Return.Prop("a", "name")));
        RoundTripFixture.Check(CypherQuery.Match(S("a")).Where(new IsNullExpression(new PropertyAccess("a", "zzz"), false)).Return(Return.Prop("a", "name")));
    });

    test("negative property-map literal", () =>
    {
        RoundTripFixture.Check(CypherQuery.Match(S("a").Prop("age", -2)).Return(Return.Prop("a", "name")));
    });

    test("arithmetic with precedence and list index", () =>
    {
        const age = Expr.Prop("a", "age");
        const sum = age.Add(Expr.Lit(1)).Mul(Expr.Lit(2));
        const diff = Expr.Lit(10).Sub(age.Sub(Expr.Lit(1)));
        const dm = age.Div(Expr.Lit(2)).Add(age.Mod(Expr.Lit(3)));
        const idx = Expr.List(Expr.Lit(5), Expr.Lit(6), age).At(Expr.Lit(2));
        RoundTripFixture.Check(CypherQuery.Match(S("a")).Return(Return.Item(sum, "s"), Return.Item(diff, "d"), Return.Item(dm, "dm"), Return.Item(idx, "i")).OrderBy(Sort.By(Expr.Var("s"))));
    });

    test("list literal, map literal, map/list parameter values", () =>
    {
        const q = CypherQuery.Unwind(Expr.Param("xs"), "x").Return(
            Return.Item(Expr.Map({ k: Expr.Var("x"), l: Expr.List(Expr.Lit(1), Expr.Lit("two")) }), "m"),
            Return.Item(Expr.Param("cfg").At(Expr.Lit("a")), "a"),
        );
        RoundTripFixture.Check(q, new Map<string, ParameterValue>([["xs", [1, 2, 3]], ["cfg", { a: 9 }]]));
    });

    test("parameter in predicate", () =>
    {
        const q = CypherQuery.Match(S("a")).Where(new Comparison(new PropertyAccess("a", "kind"), ComparisonOp.Eq, Expr.Param("k").Inner)).Return(Return.Prop("a", "name"));
        const text = RoundTripFixture.Check(q, new Map<string, ParameterValue>([["k", "core"]]));
        assert.match(text, /\$k/);
    });

    test("WITH, WITH-WHERE, RETURN", () =>
    {
        const q = CypherQuery.Match(S("a").Out("calls", S("b")))
            .With(Return.Node("b"), Fn.Count().As("c")).Where(new Comparison(new VariableRef("c"), ComparisonOp.Gte, new Literal(1)))
            .OrderBy(Expr.Var("c").Desc()).Limit(5)
            .Return(Return.Prop("b", "name", "n"), Return.Node("c"));
        RoundTripFixture.Check(q);
    });

    test("DISTINCT, ORDER BY alias and expression, SKIP, LIMIT", () =>
    {
        const q = CypherQuery.Match(S("a")).Return(Return.Prop("a", "kind", "k"), Return.Prop("a", "name", "n")).Distinct()
            .OrderBy(Sort.By(Expr.Var("k")), Sort.By(Expr.Var("n"), true)).Skip(1).Limit(3);
        RoundTripFixture.Check(q);
        RoundTripFixture.Check(CypherQuery.Match(S("a")).Return(Return.Prop("a", "name")).OrderBy(Expr.Prop("a", "name").Asc()));
    });

    test("aggregates with grouping, coalesce, UNWIND", () =>
    {
        const age = Expr.Prop("a", "age");
        const q = CypherQuery.Match(S("a")).Return(
            Return.Prop("a", "kind", "k"), Fn.Count().As("c"), Fn.CountOf(age).As("co"), Fn.CountDistinct(Expr.Prop("a", "kind")).As("cd"),
            Fn.Collect(Expr.Prop("a", "name")).As("names"), Fn.Sum(age).As("s"), Fn.Avg(age).As("av"), Fn.Min(age).As("mn"), Fn.Max(age).As("mx"),
            Fn.Coalesce(Expr.Prop("a", "zzz"), Expr.Lit("dflt")).As("co2"),
        ).OrderBy(Sort.By(Expr.Var("k")));
        RoundTripFixture.Check(q);
        RoundTripFixture.Check(CypherQuery.Unwind(Expr.List(Expr.Lit(1), Expr.Lit(2)), "x").Return(Return.Node("x")));
    });

    test("string escaping round-trips quote, backslash, and newline", () =>
    {
        const tricky = "it's a\\b\nc ''";
        const q = CypherQuery.Unwind(Expr.List(Expr.Lit(1)), "x").Return(Return.Item(Expr.Lit(tricky), "s"));
        RoundTripFixture.Check(q);
        const cell = RoundTripFixture.Engine.Execute(q.ToCypherText()).Rows[0]![0]!.ToDto();
        assert.deepEqual(cell, RoundTripFixture.Engine.Execute(q).Rows[0]![0]!.ToDto());
        RoundTripFixture.Check(CypherQuery.Match(S("a").Prop("name", "it's")).Return(Return.Node("a")));
    });
});
