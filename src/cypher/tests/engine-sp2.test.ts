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
    private static readonly NameField = "name";
    private static readonly KindField = "kind";
    private static readonly StringType = "string";
    private static readonly OptionalCard = "?";
    private static readonly ManyCard = "*";
    private static readonly KindApi = "api";
    private static readonly KindCore = "core";
    private static readonly UnexpectedCellMessage = "unexpected cell type in Plain()";

    // Graph: checkout->ledger->billing->checkout (cycle), billing->audit, vault(Core)->ledger, lonely (isolated).
    public static Engine(): CypherEngine
    {
        const logical: LogicalManifest = {
            format: Sp2Fixture.Format, model: Sp2Fixture.ModelName, version: Sp2Fixture.ModelVersion,
            root: Sp2Fixture.RootConcept,
            concepts: {
                [Sp2Fixture.RootConcept]: { extends: null, fields: {}, relationships: {}, invariants: [], annotations: [] },
                [Sp2Fixture.ServiceConcept]: {
                    extends: Sp2Fixture.RootConcept,
                    fields: {
                        [Sp2Fixture.NameField]: { type: Sp2Fixture.StringType, card: Sp2Fixture.OptionalCard },
                        [Sp2Fixture.KindField]: { type: Sp2Fixture.StringType, card: Sp2Fixture.OptionalCard },
                    },
                    relationships: { [Sp2Fixture.CallsRel]: { targets: [Sp2Fixture.ServiceConcept], card: Sp2Fixture.ManyCard, annotations: [] } },
                    invariants: [], annotations: [],
                },
                [Sp2Fixture.CoreConcept]: { extends: Sp2Fixture.ServiceConcept, fields: {}, relationships: {}, invariants: [], annotations: [] },
            },
            classes: {}, taxonomies: {},
        };
        const g = new FrozenGraph();
        const m = Manifest.load(ManifestWriter.fromLogical(logical).toJSON());
        g.PreRegister(m);
        g.Finalize(m);
        const nodes: ReflectedNode[] = [
            Sp2Fixture.Svc("s1", "checkout", Sp2Fixture.KindApi),
            Sp2Fixture.Svc("s2", "ledger", Sp2Fixture.KindCore),
            Sp2Fixture.Svc("s3", "billing", Sp2Fixture.KindCore),
            Sp2Fixture.Svc("s4", "audit", Sp2Fixture.KindApi),
            Sp2Fixture.Svc("s5", "lonely", Sp2Fixture.KindApi),
            { id: "c1", type: Sp2Fixture.CoreConcept, attrs: { [Sp2Fixture.NameField]: "vault", [Sp2Fixture.KindField]: Sp2Fixture.KindCore } },
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
        return { id, type: Sp2Fixture.ServiceConcept, attrs: { [Sp2Fixture.NameField]: name, [Sp2Fixture.KindField]: kind } };
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
        throw new Error(`${Sp2Fixture.UnexpectedCellMessage}: ${v.constructor.name}`);
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
        const all = e.Execute("MATCH p = (a:Service)-[:calls*1..3]->(b) RETURN length(p) AS len ORDER BY len");
        assert.deepEqual(Sp2Fixture.Col(all, 0), [1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3]);
        const unbounded = e.Execute("MATCH p = (a:Service)-[:calls*]->(b) WHERE a.name = 'checkout' RETURN b.name AS n, length(p) AS len, relationships(p) AS rs ORDER BY len, n");
        assert.deepEqual(unbounded.Rows.map((r) => [Sp2Fixture.Plain(r[0]!), Sp2Fixture.Plain(r[1]!)]), [["ledger", 1], ["billing", 2], ["audit", 3], ["checkout", 3]]);
        for (const row of unbounded.Rows)
        {
            const keys = (row[2] as ListValue).Items.map((x) => x.GroupKey());
            assert.equal(new Set(keys).size, keys.length, "a relationship repeated within one path");
        }
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

    test("converging join: two sources must reach the SAME bound target", () =>
    {
        // s2 (ledger) is reached by both s1 (checkout) and c1 (vault); the second path reuses the bound (b).
        // Before the fix the second Expand clobbered b, so a and c were no longer required to share a target.
        const r = e.Execute(
            "MATCH (a:Service)-[:calls]->(b:Service), (c:Service)-[:calls]->(b) RETURN a.name AS x, b.name AS y, c.name AS z ORDER BY x, y, z");
        assert.deepEqual(Sp2Fixture.Pairs(r), [
            ["billing", "audit", "billing"],
            ["billing", "checkout", "billing"],
            ["checkout", "ledger", "checkout"],
            ["checkout", "ledger", "vault"],
            ["ledger", "billing", "ledger"],
            ["vault", "ledger", "checkout"],
            ["vault", "ledger", "vault"],
        ]);
        // Every row genuinely shares b; a non-sharing combination (e.g. billing/ledger/*) is excluded.
        assert.ok(!Sp2Fixture.Pairs(r).some(([x, y]) => x === "billing" && y === "ledger"));
    });

    test("triangle: a 3-cycle only matches when the closing hop returns to the anchor", () =>
    {
        // s1->s2->s3->s1 is the only 3-cycle (up to rotation); the closing hop reuses the bound anchor (a).
        // Before the fix the closing Expand overwrote a, turning this into every 3-hop path (6 rows).
        const r = e.Execute(
            "MATCH (a:Service)-[:calls]->(b:Service)-[:calls]->(c:Service)-[:calls]->(a) RETURN a.name AS x, b.name AS y, c.name AS z ORDER BY x, y, z");
        assert.deepEqual(Sp2Fixture.Pairs(r), [
            ["billing", "checkout", "ledger"],
            ["checkout", "ledger", "billing"],
            ["ledger", "billing", "checkout"],
        ]);
    });

    test("converging join is order-independent regardless of which path binds the shared target", () =>
    {
        const first = e.Execute(
            "MATCH (a:Service)-[:calls]->(b:Service), (c:Service)-[:calls]->(b) RETURN a.name AS x, b.name AS y, c.name AS z ORDER BY x, y, z");
        const swapped = e.Execute(
            "MATCH (c:Service)-[:calls]->(b:Service), (a:Service)-[:calls]->(b) RETURN a.name AS x, b.name AS y, c.name AS z ORDER BY x, y, z");
        assert.deepEqual(Sp2Fixture.Pairs(first), Sp2Fixture.Pairs(swapped));
    });

    test("variable-length expansion into an already-bound node is a loud error", () =>
    {
        assert.throws(
            () => e.Execute("MATCH (a:Service)-[:calls]->(b:Service), (a)-[:calls*1..2]->(b) RETURN a.name AS x"),
            (err: unknown) => err instanceof CypherSemanticError && /already-bound node is not yet supported/.test((err as Error).message));
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

    test("NodeValue compares by id and ranks between scalars and lists", () =>
    {
        const r = e.Execute("MATCH (a:Service) RETURN a ORDER BY a.name");
        const nodes = r.Rows.map((row) => row[0] as NodeValue);
        assert.equal(nodes.length, 6);
        const byId = new Map(nodes.map((n) => [n.Id, n]));
        assert.ok(CypherValue.Compare(byId.get("s1")!, byId.get("s2")!) < 0);
        assert.ok(CypherValue.Compare(byId.get("s2")!, byId.get("s1")!) > 0);
        assert.equal(CypherValue.Compare(byId.get("s3")!, byId.get("s3")!), 0);
        const node = byId.get("s1")!;
        assert.ok(CypherValue.Compare(new ScalarValue(true), node) < 0);
        assert.ok(CypherValue.Compare(node, new ListValue([])) < 0);
        assert.ok(CypherValue.Compare(node, NullValue.Instance) < 0);
        const sorted = e.Execute("MATCH (a:Service) RETURN a ORDER BY a DESC");
        assert.deepEqual(sorted.Rows.map((row) => (row[0] as NodeValue).Id), ["s5", "s4", "s3", "s2", "s1", "c1"]);
    });

    test("nested unary minus and decimals evaluate", () =>
    {
        assert.deepEqual(Sp2Fixture.Pairs(e.Execute("RETURN - -1 AS a, -(-2) AS b, - - -3 AS c, 2 - -1 AS d, 1.5 + 1 AS f")), [[1, 2, -3, 3, 2.5]]);
    });

    test("coalesce(...) IN [list] evaluates; aggregate inside IN is a clear semantic error", () =>
    {
        assert.deepEqual(Sp2Fixture.Pairs(e.Execute("RETURN coalesce(null, 2) IN [2, 3] AS yes, coalesce(null, 9) IN [2, 3] AS no")), [[true, false]]);
        assert.throws(
            () => e.Execute("MATCH (a:Service) RETURN count(*) IN [1] AS x"),
            (err: unknown) => err instanceof CypherSemanticError && /direct call in a projection item/.test(err.message));
    });

    test("exact-hops *3 end-to-end", () =>
    {
        const r = e.Execute("MATCH p = (a:Service)-[:calls*3]->(b) WHERE a.name = 'checkout' RETURN b.name AS n, length(p) AS len ORDER BY n");
        assert.deepEqual(Sp2Fixture.Pairs(r), [["audit", 3], ["checkout", 3]]);
        const none = e.Execute("MATCH (a:Service)-[:calls*4]->(b) WHERE a.name = 'checkout' RETURN b.name AS n");
        assert.equal(none.Rows.length, 0);
    });

    // LATENT DEFECT (reported, not fixed): relationship variables are declared in scope but never bound by the
    // planner, so `RETURN r` is silently null for both fixed ([r:calls]) and variable-length ([r:calls*2]) rels.
    test.skip("relationship variable on a variable-length pattern binds the list of traversed relationships", () =>
    {
        const r = e.Execute("MATCH (a:Service)-[r:calls*2]->(b) WHERE a.name = 'checkout' RETURN r");
        assert.equal(r.Rows.length, 1);
        const list = r.Rows[0]![0] as ListValue;
        assert.deepEqual(list.Items.map((x) => (x as RelValue).ToRelDto()), [
            { from: "s1", type: "calls", to: "s2" },
            { from: "s2", type: "calls", to: "s3" },
        ]);
    });

describe("CypherEngine SP2 WITH ... WHERE", () =>
{
    const e = Sp2Fixture.Engine();
    const base = "MATCH (a:Service) OPTIONAL MATCH (a)-[:calls]->(b) WITH a.name AS n, count(b) AS c";

    test("WITH ... WHERE keeps only rows satisfying the predicate", () =>
    {
        const r = e.Execute(`${base} WHERE c > 0 RETURN n, c`);
        assert.deepEqual(Sp2Fixture.Pairs(r).sort((x, y) => String(x[0]).localeCompare(String(y[0]))),
            [["billing", 2], ["checkout", 1], ["ledger", 1], ["vault", 1]]);
    });

    test("WHERE filters before ORDER BY / LIMIT", () =>
    {
        const asc = e.Execute(`${base} WHERE c >= 1 ORDER BY c, n LIMIT 1 RETURN n, c`);
        assert.deepEqual(Sp2Fixture.Pairs(asc), [["checkout", 1]]);
        const desc = e.Execute(`${base} WHERE c >= 1 ORDER BY c DESC LIMIT 1 RETURN n, c`);
        assert.deepEqual(Sp2Fixture.Pairs(desc), [["billing", 2]]);
    });

    test("WHERE on an aggregate alias works as HAVING", () =>
    {
        const r = e.Execute("MATCH (a:Service)-[:calls]->(b:Service) WITH b.name AS n, count(*) AS c WHERE c > 1 RETURN n, c");
        assert.deepEqual(Sp2Fixture.Pairs(r), [["ledger", 2]]);
    });
});
});
