import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { GraphQuery } from "../../graph-api/graph-query-engine.js";
import { FrozenGraph } from "../../domain/graph.js";
import { Manifest } from "../../manifest/reflection/reflection.js";
import { ManifestWriter } from "../../manifest/manifest-writer.js";
import type { ConceptDef, LogicalManifest } from "../../manifest/logical.js";
import { GraphQueryAdapter } from "../graph.js";
import { CypherWriteStats } from "../writer.js";
import { CypherResult } from "../result.js";
import { CypherEngine } from "../engine.js";
import { NodeRefValue, NodeValue } from "../values.js";
import { CypherSemanticError, CypherWriteError } from "../errors.js";

class WriteStatsFixture
{
    public static Adapter(): GraphQueryAdapter
    {
        const empty = { fields: {}, relationships: {}, invariants: [], annotations: [] };
        const named: ConceptDef = { extends: "Element", fields: { name: { type: "string", card: "?" } }, relationships: {}, invariants: [], annotations: [] };
        const logical: LogicalManifest = {
            format: "todl-manifest/1", model: "svc", version: "1.0.0", root: "Element",
            concepts: {
                Element: { extends: null, ...empty },
                "shop.Customer": named,
                "crm.Customer": named,
                "a.b.C": { extends: "Element", ...empty },
            },
            classes: {}, taxonomies: {},
        };
        const g = new FrozenGraph();
        const m = Manifest.load(ManifestWriter.fromLogical(logical).toJSON());
        g.PreRegister(m);
        g.Finalize(m);
        g.BindSeed({ nodes: [], edges: [] }, { model: "svc", version: "1.0.0" });
        return new GraphQueryAdapter(new GraphQuery(g));
    }
}

describe("CypherWriteStats", () =>
{
    test("defaults to all zero and ToDto has the five numeric fields", () =>
    {
        const dto = new CypherWriteStats().ToDto();
        assert.deepEqual(dto, { NodesCreated: 0, NodesDeleted: 0, RelationshipsCreated: 0, RelationshipsDeleted: 0, PropertiesSet: 0 });
    });

    test("ToDto reflects mutated counters", () =>
    {
        const s = new CypherWriteStats();
        s.NodesCreated = 2;
        s.PropertiesSet = 5;
        assert.equal(s.ToDto().NodesCreated, 2);
        assert.equal(s.ToDto().PropertiesSet, 5);
    });
});

describe("CypherResult stats", () =>
{
    test("a read result has no Stats key in its DTO", () =>
    {
        const dto = CypherEngine.ToDto(new CypherResult(["a"], []));
        assert.equal("Stats" in dto, false);
    });

    test("a write result carries Stats in its DTO", () =>
    {
        const dto = CypherEngine.ToDto(new CypherResult(["a"], [], false, false, new CypherWriteStats(1)));
        assert.equal(dto.Stats?.NodesCreated, 1);
    });
});

describe("NodeRefValue", () =>
{
    test("exposes id, groups like a node, and refuses to serialize", () =>
    {
        const ref = new NodeRefValue("n1");
        assert.equal(ref.Id, "n1");
        assert.equal(ref.GroupKey(), "node:n1");
        assert.throws(() => ref.ToDto(), (e: unknown) => e instanceof CypherWriteError && /unresolved node reference/.test(e.message));
        assert.equal(NodeValue.name, "NodeValue");
    });
});

describe("GraphQueryAdapter.ResolveConcept", () =>
{
    test("exact qualified name returns the fullName", () =>
    {
        assert.equal(WriteStatsFixture.Adapter().ResolveConcept("shop.Customer"), "shop.Customer");
    });

    test("a unique simple name resolves to the fullName", () =>
    {
        assert.equal(WriteStatsFixture.Adapter().ResolveConcept("C"), "a.b.C");
    });

    test("an ambiguous simple name throws listing candidates", () =>
    {
        assert.throws(
            () => WriteStatsFixture.Adapter().ResolveConcept("Customer"),
            (e: unknown) => e instanceof CypherSemanticError && /shop\.Customer/.test(e.message) && /crm\.Customer/.test(e.message),
        );
    });

    test("an unknown name throws CypherSemanticError", () =>
    {
        assert.throws(() => WriteStatsFixture.Adapter().ResolveConcept("Nope"), CypherSemanticError);
    });
});
