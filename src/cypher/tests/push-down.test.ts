import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { GraphQuery } from "../../graph-api/graph-query-engine.js";
import { MetadataSnapshot } from "../../domain/metadata-snapshot.js";
import { Manifest } from "../../manifest/reflection/reflection.js";
import { ManifestWriter } from "../../manifest/manifest-writer.js";
import type { LogicalManifest } from "../../manifest/logical.js";
import { QueryCompareOp } from "../../model-data/connector-plan.js";
import { ConjunctiveQueryFilterProvider } from "../../model-data/conjunctive-query-filter-provider.js";
import { CypherPushDown, GraphQuerySchema } from "../push-down.js";
import type { ParameterValue } from "../values.js";

class PushDownFixture
{
    public static readonly Customer = "crm.Customer";
    public static readonly Order = "crm.Order";

    public static Schema(): GraphQuerySchema
    {
        const empty = { fields: {}, relationships: {}, invariants: [], annotations: [] };
        const logical: LogicalManifest = {
            format: "todl-manifest/1", model: "crm", version: "1.0.0", root: "Element",
            concepts: {
                Element: { extends: null, ...empty },
                "crm.Party": { extends: "Element", ...empty },
                "crm.Customer": { extends: "crm.Party", ...empty },
                "crm.Order": { extends: "Element", ...empty },
            },
            classes: {}, taxonomies: {},
        };
        const g = new MetadataSnapshot();
        const m = Manifest.load(ManifestWriter.fromLogical(logical).toJSON());
        g.PreRegister(m);
        g.Finalize(m);
        g.BindSeed({ nodes: [], edges: [] }, { model: "crm", version: "1.0.0" });
        return new GraphQuerySchema(new GraphQuery(g));
    }

    public static Where(query: string, concept: string = PushDownFixture.Customer, parameters?: ReadonlyMap<string, ParameterValue>): unknown
    {
        return CypherPushDown.Analyze(query, PushDownFixture.Schema(), parameters).WhereFor(concept);
    }

    public static Eq(field: string, value: string | number | boolean): unknown
    {
        return { Field: field, Op: QueryCompareOp.Eq, Value: value };
    }
}

describe("CypherPushDown", () =>
{
    test("pushes inline properties and top-level AND equalities of the scanned variable", () =>
    {
        const where = PushDownFixture.Where("MATCH (c:Customer {tier: 'gold'}) WHERE c.region = 'eu' AND 'x' = c.code AND c.n > 3 RETURN c");
        assert.deepEqual(where, { All: [PushDownFixture.Eq("tier", "gold"), PushDownFixture.Eq("region", "eu"), PushDownFixture.Eq("code", "x")] });
    });

    test("resolves scalar parameters and skips null or structured ones", () =>
    {
        const params = new Map<string, ParameterValue>([["r", "eu"], ["n", null], ["l", ["a"]]]);
        const where = PushDownFixture.Where("MATCH (c:Customer) WHERE c.region = $r AND c.a = $n AND c.b = $l AND c.c = $missing RETURN c", PushDownFixture.Customer, params);
        assert.deepEqual(where, { All: [PushDownFixture.Eq("region", "eu")] });
    });

    test("pushes nothing it cannot prove narrows soundly", () =>
    {
        const cases = [
            "MATCH (c:Customer) WHERE c.region <> 'eu' RETURN c",
            "MATCH (c:Customer) WHERE c.region = 'eu' OR c.tier = 'gold' RETURN c",
            "MATCH (c:Customer) WHERE NOT c.region = 'eu' RETURN c",
            "MATCH (c:Customer) WHERE c.region = null RETURN c",
            "OPTIONAL MATCH (c:Customer {region: 'eu'}) RETURN c",
            "MATCH (c:Customer {region: 'eu'}) MATCH (d:Customer) RETURN c, d",
            "MATCH (c:Customer {region: 'eu'}), (p:Party) RETURN c, p",
            "MATCH (c:Customer {region: 'eu'}), (x) RETURN c, x",
            "MATCH (c:Customer {region: 'eu'})-[*]->(o:Order) RETURN c",
            "MATCH (c:Customer {region: 'eu'}) WITH 1 AS one MATCH (c)-[:orders]->(o:Order) RETURN o",
            "MATCH (c:Customer {region: 'eu'}) SET c.seen = true RETURN c",
            "MATCH (c:Nope {region: 'eu'}) RETURN c",
            "MATCH (c:Customer {region: 'eu'} RETURN c",
        ];
        for (const query of cases) assert.equal(PushDownFixture.Where(query), undefined, query);
    });

    test("a re-referenced bound variable and a subtype scan do not block the supertype-free concept", () =>
    {
        const query = "MATCH (c:Customer {region: 'eu'}) WITH c MATCH (c)-[:orders]->(o:Order {status: 'open'}) RETURN c, o";
        assert.deepEqual(PushDownFixture.Where(query), { All: [PushDownFixture.Eq("region", "eu")] });
        assert.deepEqual(PushDownFixture.Where(query, PushDownFixture.Order), { All: [PushDownFixture.Eq("status", "open")] });
        const party = "MATCH (p:Party {name: 'a'}), (c:Customer) RETURN p, c";
        assert.deepEqual(PushDownFixture.Where(party, "crm.Party"), { All: [PushDownFixture.Eq("name", "a")] });
        assert.equal(PushDownFixture.Where(party), undefined);
    });
});

describe("ConjunctiveQueryFilterProvider", () =>
{
    test("ANDs every provider's terms and stays undefined when none filter", () =>
    {
        const policy = { WhereFor: (c: string) => (c === PushDownFixture.Customer ? { All: [{ Field: "region", Op: QueryCompareOp.Eq, Value: "eu" }] } : undefined) };
        const query = CypherPushDown.Analyze("MATCH (c:Customer {tier: 'gold'}) RETURN c", PushDownFixture.Schema());
        const both = new ConjunctiveQueryFilterProvider(policy, query);
        assert.deepEqual(both.WhereFor(PushDownFixture.Customer), { All: [PushDownFixture.Eq("region", "eu"), PushDownFixture.Eq("tier", "gold")] });
        assert.equal(both.WhereFor(PushDownFixture.Order), undefined);
    });
});
