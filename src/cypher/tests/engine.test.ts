import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { GraphQuery } from "../../graph-api/graph-query-engine.js";
import { FrozenGraph } from "../../domain/graph.js";
import { Manifest } from "../../manifest/reflection/reflection.js";
import { ManifestWriter } from "../../manifest/manifest-writer.js";
import type { LogicalManifest } from "../../manifest/logical.js";
import type { ReflectedNode } from "../../manifest/reflection/reflection.js";
import { CypherEngine } from "../engine.js";
import { CypherQuery, Pattern, Expr, Return } from "../fluent.js";
import { NodeValue, ScalarValue, NullValue } from "../values.js";
import { CypherSemanticError } from "../errors.js";

class EngineFixture
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
            format: EngineFixture.Format, model: EngineFixture.ModelName, version: EngineFixture.ModelVersion,
            root: EngineFixture.RootConcept,
            concepts: {
                Element: { extends: null, fields: {}, relationships: {}, invariants: [], annotations: [] },
                Service: {
                    extends: EngineFixture.RootConcept,
                    fields: { name: { type: "string", card: "?" } },
                    relationships: { calls: { targets: [EngineFixture.ServiceConcept], card: "*", annotations: [] } },
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
            { id: "a", type: EngineFixture.ServiceConcept, attrs: { name: "checkout" } },
            { id: "b", type: EngineFixture.ServiceConcept, attrs: { name: "ledger" } },
        ];
        g.BindSeed(
            { nodes, edges: [{ from: "a", rel: EngineFixture.CallsRel, to: "b" }] },
            { model: EngineFixture.ModelName, version: EngineFixture.ModelVersion },
        );
        return CypherEngine.OverQuery(new GraphQuery(g));
    }
}

describe("CypherEngine (integration)", () =>
{
    test("end-to-end text query returns the expected table", () =>
    {
        const result = EngineFixture.Engine().Execute("MATCH (a:Service)-[:calls]->(b:Service) WHERE a.name = 'checkout' RETURN b.name AS n");
        assert.deepEqual(result.Columns, ["n"]);
        assert.deepEqual(result.Rows.map((r) => (r[0] as ScalarValue).Value), ["ledger"]);
    });

    test("text and fluent front doors produce an identical result", () =>
    {
        const e = EngineFixture.Engine();
        const text = e.Execute("MATCH (a:Service)-[:calls]->(b:Service) WHERE a.name = 'checkout' RETURN b.name AS n");
        const fluent = e.Execute(
            CypherQuery
                .Match(Pattern.Node("a").Label("Service").Out("calls", Pattern.Node("b").Label("Service")))
                .Where(Expr.Prop("a", "name").Eq("checkout"))
                .Return(Return.Prop("b", "name", "n")),
        );
        assert.deepEqual(text.Columns, fluent.Columns);
        assert.deepEqual(
            text.Rows.map((r) => (r[0] as ScalarValue).Value),
            fluent.Rows.map((r) => (r[0] as ScalarValue).Value),
        );
    });

    test("returned node projects to a ReflectedEntity through its reader", () =>
    {
        const result = EngineFixture.Engine().Execute("MATCH (a:Service) WHERE a.name = 'checkout' RETURN a");
        const node = result.Rows[0][0] as NodeValue;
        assert.equal(node.Concept, "Service");
        assert.equal(node.Reader().field("name"), "checkout");
    });

    test("missing property reads as null in RETURN", () =>
    {
        const result = EngineFixture.Engine().Execute("MATCH (a:Service) WHERE a.name = 'checkout' RETURN a.ghost AS g");
        assert.ok(result.Rows[0][0] instanceof NullValue);
    });

    test("ToDto serializes node cells via the snapshot projector", () =>
    {
        const result = EngineFixture.Engine().Execute("MATCH (a:Service) WHERE a.name = 'checkout' RETURN a");
        const dto = CypherEngine.ToDto(result);
        const cell = dto.Rows[0][0] as { id: string; concept: string };
        assert.equal(cell.id, "a");
        assert.equal(cell.concept, "Service");
    });

    test("inline property map folds into a filter end-to-end", () =>
    {
        const result = EngineFixture.Engine().Execute("MATCH (a:Service {name: 'checkout'}) RETURN a.name AS n");
        assert.deepEqual(result.Rows.map((r) => (r[0] as ScalarValue).Value), ["checkout"]);
    });

    test("relationship property maps are rejected", () =>
    {
        assert.throws(
            () => EngineFixture.Engine().Execute("MATCH (a:Service)-[:calls {weight: 1}]->(b:Service) RETURN a"),
            CypherSemanticError,
        );
    });

    test("anonymous positional variables are not user-declared and are rejected", () =>
    {
        assert.throws(
            () => EngineFixture.Engine().Execute("MATCH (a:Service) RETURN __n0"),
            CypherSemanticError,
        );
    });
});
