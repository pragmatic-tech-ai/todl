import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { GraphQuery } from "../../graph-api/graph-query-engine.js";
import { FrozenGraph } from "../../domain/graph.js";
import { Manifest } from "../../manifest/reflection/reflection.js";
import { ManifestWriter } from "../../manifest/manifest-writer.js";
import type { LogicalManifest } from "../../manifest/logical.js";
import type { ReflectedNode } from "../../manifest/reflection/reflection.js";
import type { MirrorSnapshot } from "../../graph-api/index.js";
import { SnapshotReader } from "../../reflection-client/index.js";
import { CypherEngine } from "../engine.js";
import { CypherQuery, Pattern, Expr, Return, Sort, Fn } from "../fluent.js";
import { CypherValue, NodeValue, ScalarValue, NullValue } from "../values.js";
import { ListValue, MapValue, PathValue, RelValue } from "../values-structured.js";
import { CypherSemanticError } from "../errors.js";
import type { CypherResult } from "../result.js";

class Sp2Fixture
{
    private static readonly ModelName = "svc2";
    private static readonly ModelVersion = "1.0.0";
    private static readonly Format = "todl-manifest/1";
    private static readonly RootConcept = "Element";
    private static readonly ServiceConcept = "Service";
    private static readonly CoreConcept = "CoreService";
    private static readonly CallsRel = "calls";

    // Graph: checkout->ledger->billing->checkout (cycle), billing->audit, vault(Core)->ledger, lonely (isolated).
    public static Engine(): CypherEngine
    {
        const logical: LogicalManifest = {
            format: Sp2Fixture.Format, model: Sp2Fixture.ModelName, version: Sp2Fixture.ModelVersion,
            root: Sp2Fixture.RootConcept,
            concepts: {
                Element: { extends: null, fields: {}, relationships: {}, invariants: [], annotations: [] },
                Service: {
                    extends: Sp2Fixture.RootConcept,
                    fields: { name: { type: "string", card: "?" }, kind: { type: "string", card: "?" } },
                    relationships: { calls: { targets: [Sp2Fixture.ServiceConcept], card: "*", annotations: [] } },
                    invariants: [], annotations: [],
                },
                CoreService: { extends: Sp2Fixture.ServiceConcept, fields: {}, relationships: {}, invariants: [], annotations: [] },
            },
            classes: {}, taxonomies: {},
        };
        const g = new FrozenGraph();
        const m = Manifest.load(ManifestWriter.fromLogical(logical).toJSON());
        g.PreRegister(m);
        g.Finalize(m);
        const nodes: ReflectedNode[] = [
            Sp2Fixture.Svc("s1", "checkout", "api"),
            Sp2Fixture.Svc("s2", "ledger", "core"),
            Sp2Fixture.Svc("s3", "billing", "core"),
            Sp2Fixture.Svc("s4", "audit", "api"),
            Sp2Fixture.Svc("s5", "lonely", "api"),
            { id: "c1", type: Sp2Fixture.CoreConcept, attrs: { name: "vault", kind: "core" } },
        ];
        const edges = [
            { from: "s1", rel: Sp2Fixture.CallsRel, to: "s2" },
            { from: "s2", rel: Sp2Fixture.CallsRel, to: "s3" },
            { from: "s3", rel: Sp2Fixture.CallsRel, to: "s1" },
            { from: "s3", rel: Sp2Fixture.CallsRel, to: "s4" },
            { from: "c1", rel: Sp2Fixture.CallsRel, to: "s2" },
        ];
        g.BindSeed({ nodes, edges }, { model: Sp2Fixture.ModelName, version: Sp2Fixture.ModelVersion });
        return CypherEngine.OverQuery(new GraphQuery(g));
    }

    public static Svc(id: string, name: string, kind: string): ReflectedNode
    {
        return { id, type: Sp2Fixture.ServiceConcept, attrs: { name, kind } };
    }

    public static Col(result: CypherResult, index: number): unknown[]
    {
        return result.Rows.map((r) => Sp2Fixture.Plain(r[index]!));
    }

    public static Pairs(result: CypherResult): unknown[][]
    {
        return result.Rows.map((r) => r.map((v) => Sp2Fixture.Plain(v)));
    }

    public static Plain(v: CypherValue): unknown
    {
        if (v instanceof ScalarValue) return v.Value;
        if (v instanceof NullValue) return null;
        if (v instanceof ListValue) return v.Items.map((i) => Sp2Fixture.Plain(i));
        if (v instanceof NodeValue) return v.Id;
        return v.GroupKey();
    }
}

describe("CypherEngine SP2 read-plus (end-to-end)", () =>
{
    const e = Sp2Fixture.Engine();

    test("subtype instances match the supertype label", () =>
    {
        const r = e.Execute("MATCH (a:Service) RETURN a.name AS n ORDER BY n");
        assert.deepEqual(Sp2Fixture.Col(r, 0), ["audit", "billing", "checkout", "ledger", "lonely", "vault"]);
        const c = e.Execute("MATCH (a:CoreService) RETURN a.name AS n");
        assert.deepEqual(Sp2Fixture.Col(c, 0), ["vault"]);
    });

    test("WITH chaining carries projected variables", () =>
    {
        const r = e.Execute("MATCH (a:Service) WITH a.name AS n ORDER BY n SKIP 3 LIMIT 1 RETURN n");
        assert.deepEqual(Sp2Fixture.Col(r, 0), ["ledger"]);
        const r2 = e.Execute("MATCH (a:Service)-[:calls]->(b:Service) WITH b, count(*) AS c ORDER BY c DESC LIMIT 1 RETURN b.name AS n, c");
        assert.deepEqual(Sp2Fixture.Pairs(r2), [["ledger", 2]]);
    });

    test("variable not carried through WITH is out of scope (semantic error)", () =>
    {
        assert.throws(() => e.Execute("MATCH (a:Service) WITH a.name AS n RETURN a"), CypherSemanticError);
        assert.throws(() => e.Execute("MATCH (a:Service)-[:calls]->(b:Service) WITH a RETURN b.name"), CypherSemanticError);
    });

    test("aggregation with grouping: count and collect", () =>
    {
        const r = e.Execute("MATCH (a:Service) RETURN a.kind AS k, count(*) AS c, collect(a.name) AS names ORDER BY k");
        assert.deepEqual(r.Columns, ["k", "c", "names"]);
        assert.deepEqual(Sp2Fixture.Col(r, 0), ["api", "core"]);
        assert.deepEqual(Sp2Fixture.Col(r, 1), [3, 3]);
        const names = Sp2Fixture.Col(r, 2) as string[][];
        assert.deepEqual([...names[0]!].sort(), ["audit", "checkout", "lonely"]);
        assert.deepEqual([...names[1]!].sort(), ["billing", "ledger", "vault"]);
    });

    test("ORDER BY / SKIP / LIMIT / DISTINCT", () =>
    {
        const desc = e.Execute("MATCH (a:Service) RETURN a.name AS n ORDER BY n DESC");
        assert.deepEqual(Sp2Fixture.Col(desc, 0), ["vault", "lonely", "ledger", "checkout", "billing", "audit"]);
        const win = e.Execute("MATCH (a:Service) RETURN a.name AS n ORDER BY n SKIP 1 LIMIT 2");
        assert.deepEqual(Sp2Fixture.Col(win, 0), ["billing", "checkout"]);
        const distinct = e.Execute("MATCH (a:Service) RETURN DISTINCT a.kind AS k ORDER BY k");
        assert.deepEqual(Sp2Fixture.Col(distinct, 0), ["api", "core"]);
    });

    test("OPTIONAL MATCH keeps the row with a null cell when nothing matches", () =>
    {
        const lonely = e.Execute("MATCH (a:Service) WHERE a.name = 'lonely' OPTIONAL MATCH (a)-[:calls]->(b:Service) RETURN a.name AS n, b.name AS m");
        assert.equal(lonely.Rows.length, 1);
        assert.equal((lonely.Rows[0]![0] as ScalarValue).Value, "lonely");
        assert.ok(lonely.Rows[0]![1] instanceof NullValue);
        const mixed = e.Execute("MATCH (a:Service) OPTIONAL MATCH (a)-[:calls]->(b:Service) RETURN a.name AS n, b.name AS m ORDER BY n, m");
        assert.equal(mixed.Rows.length, 7);
        const audit = mixed.Rows.find((row) => (row[0] as ScalarValue).Value === "audit")!;
        assert.ok(audit[1] instanceof NullValue);
    });

    test("variable-length paths: bounds, path functions, cycle safety", () =>
    {
        const r = e.Execute("MATCH p = (a:Service)-[:calls*1..3]->(b) WHERE a.name = 'checkout' RETURN b.name AS n, length(p) AS len ORDER BY len, n");
        assert.deepEqual(Sp2Fixture.Pairs(r), [["ledger", 1], ["billing", 2], ["audit", 3], ["checkout", 3]]);
        const exact = e.Execute("MATCH p = (a:Service)-[:calls*2..2]->(b) WHERE a.name = 'checkout' RETURN b.name AS n");
        assert.deepEqual(Sp2Fixture.Col(exact, 0), ["billing"]);
        const all = e.Execute("MATCH p = (a:Service)-[:calls*1..3]->(b) RETURN length(p) AS len");
        assert.ok(all.Rows.length > 0 && all.Rows.length < 100);
        const unbounded = e.Execute("MATCH p = (a:Service)-[:calls*]->(b) WHERE a.name = 'checkout' RETURN length(p) AS len");
        assert.ok(unbounded.Rows.length > 0 && unbounded.Rows.length < 100);
    });

    test("nodes(p) and relationships(p)", () =>
    {
        const r = e.Execute("MATCH p = (a:Service)-[:calls*2..2]->(b) WHERE a.name = 'checkout' RETURN nodes(p) AS ns, relationships(p) AS rs");
        assert.equal(r.Rows.length, 1);
        const ns = r.Rows[0]![0] as ListValue;
        assert.deepEqual(ns.Items.map((n) => (n as NodeValue).Id), ["s1", "s2", "s3"]);
        const rs = r.Rows[0]![1] as ListValue;
        assert.deepEqual(rs.Items.map((x) => (x as RelValue).ToRelDto()), [
            { from: "s1", type: "calls", to: "s2" },
            { from: "s2", type: "calls", to: "s3" },
        ]);
    });

    test("UNWIND list literal, scalar parameter, and null", () =>
    {
        assert.deepEqual(Sp2Fixture.Col(e.Execute("UNWIND [1, 2, 3] AS x RETURN x"), 0), [1, 2, 3]);
        assert.deepEqual(Sp2Fixture.Col(e.Execute("UNWIND $xs AS x RETURN x", new Map([["xs", 7]])), 0), [7]);
        assert.equal(e.Execute("UNWIND null AS x RETURN x").Rows.length, 0);
    });

    test("list/map literals and index access in RETURN", () =>
    {
        const r = e.Execute("RETURN [10, 20, 30][1] AS i, {a: 1, b: 'x'} AS m, [1, 2] AS l");
        assert.equal((r.Rows[0]![0] as ScalarValue).Value, 20);
        const m = r.Rows[0]![1] as MapValue;
        assert.equal((m.Get("a") as ScalarValue).Value, 1);
        assert.equal((m.Get("b") as ScalarValue).Value, "x");
        assert.deepEqual(Sp2Fixture.Plain(r.Rows[0]![2]!), [1, 2]);
        const mi = e.Execute("RETURN {a: 5}['a'] AS v");
        assert.equal((mi.Rows[0]![0] as ScalarValue).Value, 5);
    });

    test("multi-path MATCH: cartesian product and shared-variable join", () =>
    {
        const cart = e.Execute("MATCH (a:Service), (b:Service) RETURN a, b");
        assert.equal(cart.Rows.length, 36);
        const join = e.Execute("MATCH (a:Service)-[:calls]->(b:Service), (b)-[:calls]->(c:Service) RETURN a.name AS x, c.name AS z ORDER BY x, z");
        assert.deepEqual(Sp2Fixture.Pairs(join), [
            ["billing", "ledger"],
            ["checkout", "billing"],
            ["ledger", "audit"],
            ["ledger", "checkout"],
            ["vault", "billing"],
        ]);
    });

    test("ToDto: list/map/rel/path cells have the documented shapes", () =>
    {
        const r = e.Execute("MATCH p = (a:Service)-[:calls*1..1]->(b) WHERE a.name = 'checkout' RETURN [1, 2] AS l, {k: 'v'} AS m, relationships(p) AS rs, p");
        const dto = CypherEngine.ToDto(r);
        assert.deepEqual(dto.Columns, ["l", "m", "rs", "p"]);
        const row = dto.Rows[0]!;
        assert.deepEqual(row[0], [1, 2]);
        assert.deepEqual(row[1], { k: "v" });
        assert.deepEqual(row[2], [{ from: "s1", type: "calls", to: "s2" }]);
        const path = row[3] as unknown as { nodes: MirrorSnapshot[]; relationships: unknown[] };
        assert.deepEqual(path.nodes.map((n) => n.id), ["s1", "s2"]);
        assert.deepEqual(path.relationships, [{ from: "s1", type: "calls", to: "s2" }]);
        assert.ok(r.Rows[0]![3] instanceof PathValue);
    });

    test("node nested in nodes(p) DTO is a MirrorSnapshot that SnapshotReader rehydrates", () =>
    {
        const r = e.Execute("MATCH p = (a:Service)-[:calls*2..2]->(b) WHERE a.name = 'checkout' RETURN nodes(p) AS ns");
        const dto = CypherEngine.ToDto(r);
        const list = dto.Rows[0]![0] as unknown as MirrorSnapshot[];
        const reader = new SnapshotReader(list[1]!);
        assert.equal(reader.id, "s2");
        assert.equal(reader.concept, "Service");
        assert.equal(reader.field("name"), "ledger");
        assert.equal(reader.field("kind"), "core");
    });

    test("parity: text and fluent produce identical results on an aggregating query", () =>
    {
        const text = e.Execute(
            "MATCH (a:Service)-[:calls]->(b:Service) WHERE a.kind = 'core' RETURN b.name AS n, count(*) AS c ORDER BY n",
        );
        const fluent = e.Execute(
            CypherQuery
                .Match(Pattern.Node("a").Label("Service").Out("calls", Pattern.Node("b").Label("Service")))
                .Where(Expr.Prop("a", "kind").Eq("core"))
                .Return(Return.Prop("b", "name", "n"), Return.Item(Fn.Count(), "c"))
                .OrderBy(Sort.By(Expr.Var("n"))),
        );
        assert.deepEqual(text.Columns, fluent.Columns);
        assert.deepEqual(CypherEngine.ToDto(text), CypherEngine.ToDto(fluent));
    });
});
