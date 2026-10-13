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
import { MatchClause } from "../query-model.js";
import { ScalarValue } from "../values.js";
import { CypherSemanticError } from "../errors.js";

class VarLengthFixture
{
    private static readonly ModelName = "svc";
    private static readonly ModelVersion = "1.0.0";
    private static readonly Format = "todl-manifest/1";
    private static readonly RootConcept = "Element";
    private static readonly ServiceConcept = "Service";
    private static readonly CallsRel = "calls";

    public static FirstRel(text: string): { Min: number | undefined; Max: number | undefined; Path: string | undefined }
    {
        const match = new CypherParser(text).Parse().Parts[0]!.Reading[0] as MatchClause;
        const path = match.Paths[0]!;
        return { Min: path.Rels[0]!.MinHops, Max: path.Rels[0]!.MaxHops, Path: path.PathVariable };
    }

    // Chain a -> b -> c -> d.
    public static Engine(): CypherEngine
    {
        const logical: LogicalManifest = {
            format: VarLengthFixture.Format, model: VarLengthFixture.ModelName, version: VarLengthFixture.ModelVersion,
            root: VarLengthFixture.RootConcept,
            concepts: {
                Element: { extends: null, fields: {}, relationships: {}, invariants: [], annotations: [] },
                Service: {
                    extends: VarLengthFixture.RootConcept,
                    fields: { name: { type: "string", card: "?" } },
                    relationships: { calls: { targets: [VarLengthFixture.ServiceConcept], card: "*", annotations: [] } },
                    invariants: [], annotations: [],
                },
            },
            classes: {}, taxonomies: {},
        };
        const g = new FrozenGraph();
        const m = Manifest.load(ManifestWriter.fromLogical(logical).toJSON());
        g.PreRegister(m);
        g.Finalize(m);
        const nodes: ReflectedNode[] = ["a", "b", "c", "d"].map((id) => (
            { id, type: VarLengthFixture.ServiceConcept, attrs: { name: id } }));
        const edges = [["a", "b"], ["b", "c"], ["c", "d"]].map(([from, to]) => (
            { from: from!, rel: VarLengthFixture.CallsRel, to: to! }));
        g.BindSeed({ nodes, edges }, { model: VarLengthFixture.ModelName, version: VarLengthFixture.ModelVersion });
        return CypherEngine.OverQuery(new GraphQuery(g));
    }
}

describe("variable-length rels + path variables", () =>
{
    test("bare star is 1..unbounded", () =>
    {
        assert.deepEqual(VarLengthFixture.FirstRel("MATCH (a)-[*]->(b) RETURN b"), { Min: 1, Max: undefined, Path: undefined });
    });

    test("*n is exactly n", () =>
    {
        assert.deepEqual(VarLengthFixture.FirstRel("MATCH (a)-[:calls*3]->(b) RETURN b"), { Min: 3, Max: 3, Path: undefined });
    });

    test("*n.. is min n, unbounded", () =>
    {
        assert.deepEqual(VarLengthFixture.FirstRel("MATCH (a)-[*2..]->(b) RETURN b"), { Min: 2, Max: undefined, Path: undefined });
    });

    test("*..m is 1..m", () =>
    {
        assert.deepEqual(VarLengthFixture.FirstRel("MATCH (a)-[*..5]->(b) RETURN b"), { Min: 1, Max: 5, Path: undefined });
    });

    test("*n..m", () =>
    {
        assert.deepEqual(VarLengthFixture.FirstRel("MATCH (a)-[r:calls*2..5]->(b) RETURN b"), { Min: 2, Max: 5, Path: undefined });
    });

    test("fixed rel has undefined hops", () =>
    {
        assert.deepEqual(VarLengthFixture.FirstRel("MATCH (a)-[:calls]->(b) RETURN b"), { Min: undefined, Max: undefined, Path: undefined });
    });

    test("path variable + hop bounds", () =>
    {
        assert.deepEqual(VarLengthFixture.FirstRel("MATCH p = (a)-[*1..2]->(b) RETURN p"), { Min: 1, Max: 2, Path: "p" });
    });

    test("end-to-end: var-length returns reachable endpoints", () =>
    {
        const result = VarLengthFixture.Engine().Execute(
            "MATCH (a:Service)-[:calls*1..2]->(b) WHERE a.name = 'a' RETURN b.name AS n");
        const names = result.Rows.map((r) => (r[0] as ScalarValue).Value).sort();
        assert.deepEqual(names, ["b", "c"]);
    });

    test("end-to-end: unbounded star reaches the whole chain", () =>
    {
        const result = VarLengthFixture.Engine().Execute(
            "MATCH (a:Service)-[:calls*]->(b) WHERE a.name = 'a' RETURN b.name AS n");
        assert.deepEqual(result.Rows.map((r) => (r[0] as ScalarValue).Value).sort(), ["b", "c", "d"]);
    });

    test("end-to-end: path variable binds a PathValue (length)", () =>
    {
        const result = VarLengthFixture.Engine().Execute(
            "MATCH p = (a:Service)-[:calls*1..2]->(b) WHERE a.name = 'a' RETURN b.name AS n, length(p) AS len");
        const rows = result.Rows.map((r) => [(r[0] as ScalarValue).Value, (r[1] as ScalarValue).Value]);
        rows.sort();
        assert.deepEqual(rows, [["b", 1], ["c", 2]]);
    });

    test("path variable without a var-length rel is rejected", () =>
    {
        assert.throws(
            () => VarLengthFixture.Engine().Execute("MATCH p = (a:Service)-[:calls]->(b) RETURN p"),
            CypherSemanticError);
    });
});
