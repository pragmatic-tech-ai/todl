import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { GraphQuery } from "../../graph-api/graph-query-engine.js";
import { FrozenGraph } from "../../domain/graph.js";
import { Manifest } from "../../manifest/reflection/reflection.js";
import { ManifestWriter } from "../../manifest/manifest-writer.js";
import type { LogicalManifest } from "../../manifest/logical.js";
import type { ReflectedNode } from "../../manifest/reflection/reflection.js";
import { CypherEngine } from "../engine.js";
import { ScalarValue } from "../values.js";
import { CypherSemanticError } from "../errors.js";

class Sp2Fixture
{
    private static readonly ModelName = "svc";
    private static readonly ModelVersion = "1.0.0";
    private static readonly Format = "todl-manifest/1";
    private static readonly RootConcept = "Element";
    private static readonly ServiceConcept = "Service";
    private static readonly CallsRel = "calls";

    public static Engine(): CypherEngine
    {
        const logical: LogicalManifest = {
            format: Sp2Fixture.Format, model: Sp2Fixture.ModelName, version: Sp2Fixture.ModelVersion,
            root: Sp2Fixture.RootConcept,
            concepts: {
                Element: { extends: null, fields: {}, relationships: {}, invariants: [], annotations: [] },
                Service: {
                    extends: Sp2Fixture.RootConcept,
                    fields: { name: { type: "string", card: "?" } },
                    relationships: { calls: { targets: [Sp2Fixture.ServiceConcept], card: "*", annotations: [] } },
                    invariants: [], annotations: [],
                },
            },
            classes: {}, taxonomies: {},
        };
        const g = new FrozenGraph();
        const m = Manifest.load(ManifestWriter.fromLogical(logical).toJSON());
        g.PreRegister(m);
        g.Finalize(m);
        const nodes: ReflectedNode[] = [
            { id: "a", type: Sp2Fixture.ServiceConcept, attrs: { name: "checkout" } },
            { id: "b", type: Sp2Fixture.ServiceConcept, attrs: { name: "ledger" } },
            { id: "c", type: Sp2Fixture.ServiceConcept, attrs: { name: "audit" } },
        ];
        g.BindSeed(
            {
                nodes,
                edges: [
                    { from: "a", rel: Sp2Fixture.CallsRel, to: "b" },
                    { from: "a", rel: Sp2Fixture.CallsRel, to: "c" },
                ],
            },
            { model: Sp2Fixture.ModelName, version: Sp2Fixture.ModelVersion },
        );
        return CypherEngine.OverQuery(new GraphQuery(g));
    }

    public static Scalars(engine: CypherEngine, text: string): unknown[]
    {
        const result = engine.Execute(text);
        return result.Rows.map((r) => (r[0] as ScalarValue).Value);
    }
}

describe("cypher planner SP2 (segment pipeline)", () =>
{
    test("WITH chain carries a projected variable into a later RETURN", () =>
    {
        const rows = Sp2Fixture.Scalars(
            Sp2Fixture.Engine(),
            "MATCH (a:Service) WITH a AS svc RETURN svc.name AS n ORDER BY n",
        );
        assert.deepEqual(rows, ["audit", "checkout", "ledger"]);
    });

    test("aggregating RETURN with grouping and count(*)", () =>
    {
        const result = Sp2Fixture.Engine().Execute(
            "MATCH (a:Service)-[:calls]->(b:Service) RETURN a.name AS caller, count(*) AS c",
        );
        assert.deepEqual(result.Columns, ["caller", "c"]);
        assert.equal(result.Rows.length, 1);
        assert.equal((result.Rows[0]![0] as ScalarValue).Value, "checkout");
        assert.equal((result.Rows[0]![1] as ScalarValue).Value, 2);
    });

    test("bare count(*) aggregates all rows into a single group", () =>
    {
        const rows = Sp2Fixture.Scalars(Sp2Fixture.Engine(), "MATCH (a:Service) RETURN count(*) AS c");
        assert.deepEqual(rows, [3]);
    });

    test("ORDER BY DESC then LIMIT truncates the sorted stream", () =>
    {
        const rows = Sp2Fixture.Scalars(
            Sp2Fixture.Engine(),
            "MATCH (a:Service) RETURN a.name AS n ORDER BY n DESC LIMIT 1",
        );
        assert.deepEqual(rows, ["ledger"]);
    });

    test("ORDER BY on a name that is not a projected column raises CypherSemanticError", () =>
    {
        assert.throws(
            () => Sp2Fixture.Engine().Execute("MATCH (a:Service) RETURN a.name AS n ORDER BY nope"),
            CypherSemanticError,
        );
    });

    test("RETURN a.name ORDER BY a.name sorts without throwing", () =>
    {
        const rows = Sp2Fixture.Scalars(Sp2Fixture.Engine(), "MATCH (a:Service) RETURN a.name ORDER BY a.name DESC");
        assert.deepEqual(rows, ["ledger", "checkout", "audit"]);
    });

    test("aliased projection can ORDER BY the original property expression", () =>
    {
        const rows = Sp2Fixture.Scalars(Sp2Fixture.Engine(), "MATCH (a:Service) RETURN a.name AS n ORDER BY a.name");
        assert.deepEqual(rows, ["audit", "checkout", "ledger"]);
    });

    test("ORDER BY a property of a projected variable works", () =>
    {
        const result = Sp2Fixture.Engine().Execute("MATCH (a:Service) RETURN a AS a ORDER BY a.name");
        assert.equal(result.Rows.length, 3);
        const names = result.Rows.map((r) => (r[0] as { Field(k: string): unknown }).Field("name"));
        assert.deepEqual(names, ["audit", "checkout", "ledger"]);
    });

    test("variable-length *..0 (min 1 > max 0) raises CypherSemanticError", () =>
    {
        assert.throws(
            () => Sp2Fixture.Engine().Execute("MATCH (a:Service)-[:calls*..0]->(b:Service) RETURN b.name AS n"),
            CypherSemanticError,
        );
    });

    test("variable-length min greater than max raises CypherSemanticError", () =>
    {
        assert.throws(
            () => Sp2Fixture.Engine().Execute("MATCH (a:Service)-[:calls*3..1]->(b:Service) RETURN b.name AS n"),
            CypherSemanticError,
        );
    });

    test("referencing a variable dropped by WITH raises CypherSemanticError", () =>
    {
        assert.throws(
            () => Sp2Fixture.Engine().Execute("MATCH (a:Service) WITH a.name AS n RETURN a"),
            CypherSemanticError,
        );
    });
});
