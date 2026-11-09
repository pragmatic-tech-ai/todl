import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { AccessScope, Cypher } from "@pragmatic-tech-ai/graph";
import { Snapshot, type MirrorSnapshot } from "../../graph-api/index.js";
import { compilePackage } from "../../publish/publish.js";
import { PackageManifestBridge } from "../../solution-services/package-manager/package-manifest-bridge.js";
import { Domain } from "../../domain/domain.js";
import { MemoryPackageSource } from "../../domain/memory-package-source.js";
import type { CypherResultDto } from "../../cypher/index.js";
import type { MetadataSnapshot } from "../../domain/metadata-snapshot.js";
import { TodlNames } from "../TodlNames.js";
import { EngineCellMapper } from "../EngineCellMapper.js";
import { EngineFixture } from "./EngineFixture.js";

/** Runs queries on a fixture's engine and maps the result cells. */
class MapperHarness
{
    public static readonly AllNodes = "MATCH (n) RETURN n";
    public static readonly NodeKey = "$node";
    public static readonly PassThroughQuery = "RETURN 1 AS a, 'x' AS b, null AS c, [1, 2] AS d, {k: 1} AS e, {`$node`: 1} AS f, 2.5 AS g";
    public static readonly NestedQuery = "MATCH (n) WITH collect(n) AS ns RETURN ns AS l, {k: ns} AS m";
    public static readonly AspectsFixture = "aspects.todl";
    private static readonly Fixtures = [MapperHarness.AspectsFixture, "order-fulfillment.todl", "shop"];
    private static readonly MinimumNodes = 1;
    public static readonly ShopName = "shop";
    private static readonly ShopModel = "shop.p";
    private static readonly ShopVersion = "1.0.0";
    /** Exercises what the fixtures do not: classes, fixing terms, taxonomy fields, numbers, aspects and links. */
    private static readonly Shop = `namespace shop
{
    primitive sku : string { }
    concept Loc { }
    aspect Placed { relationship at -> Loc?; }
    concept Widget : Placed
    {
        name : string?; count : integer?; weight : number?; ok : boolean?; code : sku?;
        kind : Kinds?; kinds : Kinds[]; home : Loc?;
        relationship parts -> Widget[];
    }
    taxonomy Kinds : represents Widget { term Big { label = "Big one"; term Huge { } } term Small { count = 9; } }
    model Shop : shop
    {
        Loc l1 { }
        Widget w0 instanceof Kinds.Big
        {
            name = "w"; count = 3; weight = 1.5; ok = true; code = "AB";
            kind = Small; kinds = [Big, Huge]; home = l1; parts = [w1]; at = l1;
        }
        Widget w1 { label = "Second"; }
        Widget w3 { label = "Explicit"; name = "Named"; }
        Widget w2 instanceof Kinds.Small { name = "named"; }
    }
}`;

    public static get FixtureNames(): readonly string[]
    {
        return MapperHarness.Fixtures;
    }

    public static async ShopGraph(): Promise<MetadataSnapshot>
    {
        const out = compilePackage([], [{ uri: "shop.todl", text: MapperHarness.Shop }], { id: MapperHarness.ShopModel, version: MapperHarness.ShopVersion });
        assert.ok(out.ok, JSON.stringify(out.errors));
        const domain = new Domain(new MemoryPackageSource([PackageManifestBridge.toResolved(out.package!)]));
        await domain.load({ model: MapperHarness.ShopModel, version: MapperHarness.ShopVersion });
        return domain.graph;
    }

    public static async Run(fixture: string, query: string): Promise<{ graph: MetadataSnapshot; mapped: CypherResultDto; raw: Cypher.CypherResultDto }>
    {
        return MapperHarness.RunOn(fixture === MapperHarness.ShopName ? await MapperHarness.ShopGraph() : EngineFixture.Graph(EngineFixture.Repo([fixture])), query);
    }

    public static async RunOn(graph: MetadataSnapshot, query: string): Promise<{ graph: MetadataSnapshot; mapped: CypherResultDto; raw: Cypher.CypherResultDto }>
    {
        const engine = await EngineFixture.Open(EngineFixture.Describe(graph));
        try
        {
            const result = await new Cypher.CypherEngine(engine).Execute(AccessScope.System, query);
            const raw = Cypher.CypherEngine.ToDto(result);
            return { graph, mapped: new EngineCellMapper(graph).MapResult(raw), raw };
        }
        finally
        {
            await engine.dispose();
        }
    }

    public static async CheckParity(fixture: string): Promise<number>
    {
        const { graph, mapped, raw } = await MapperHarness.Run(fixture, MapperHarness.AllNodes);
        assert.equal(mapped.Truncated, false);
        assert.deepEqual(mapped.Columns, raw.Columns);
        const byId = new Map<string, MirrorSnapshot>();
        for (const row of mapped.Rows)
        {
            const snap = (row[0] as unknown as Record<string, MirrorSnapshot>)[MapperHarness.NodeKey]!;
            byId.set(snap.id, snap);
        }
        const nodes = graph.allNodes();
        for (const node of nodes)
        {
            const got = byId.get(node.id);
            assert.ok(got !== undefined, `${fixture}: ${node.id} missing from the engine rows`);
            assert.deepEqual(got, Snapshot.of(graph.reflect(node)), `${fixture}: ${node.id}`);
        }
        // Every engine row is a heap node compared above, or a seeded taxonomy term (not on the heap).
        for (const snap of byId.values())
        {
            assert.ok(graph.getNode(snap.id) !== undefined || snap.concept === TodlNames.Term, `${fixture}: unexpected row ${snap.id}`);
        }
        assert.ok(nodes.length >= MapperHarness.MinimumNodes, `${fixture}: ${nodes.length} nodes`);
        return nodes.length;
    }
}

describe("EngineCellMapper", () =>
{
    for (const fixture of MapperHarness.FixtureNames)
    {
        test(`parity with Snapshot.of: ${fixture}`, async () =>
        {
            await MapperHarness.CheckParity(fixture);
        });
    }

    test("non-node cells pass through", async () =>
    {
        const { mapped } = await MapperHarness.Run(MapperHarness.AspectsFixture, MapperHarness.PassThroughQuery);
        assert.deepEqual(mapped.Rows[0], [1, "x", null, [1, 2], { k: 1 }, { $map: { $node: 1 } }, 2.5]);
    });

    test("nested nodes in lists and maps are mapped", async () =>
    {
        const { mapped, graph } = await MapperHarness.Run(MapperHarness.AspectsFixture, MapperHarness.NestedQuery);
        const [list, map] = mapped.Rows[0] as [unknown[], Record<string, unknown>];
        let compared = 0;
        for (const item of list)
        {
            const snap = (item as Record<string, MirrorSnapshot>)[MapperHarness.NodeKey]!;
            const node = graph.getNode(snap.id);
            if (node === undefined) continue;
            assert.deepEqual(snap, Snapshot.of(graph.reflect(node)));
            compared++;
        }
        assert.ok(compared > 0);
        assert.deepEqual(map["k"], list);
    });

    test("label precedence: explicit label, then name, then id", async () =>
    {
        const { mapped } = await MapperHarness.RunOn(await MapperHarness.ShopGraph(), MapperHarness.AllNodes);
        const labels = new Map<string, string>();
        for (const row of mapped.Rows)
        {
            const snap = (row[0] as unknown as Record<string, MirrorSnapshot>)[MapperHarness.NodeKey]!;
            labels.set(snap.id, snap.label);
        }
        assert.equal(labels.get("shop.w3"), "Explicit");
        assert.equal(labels.get("shop.w2"), "named");
        assert.equal(labels.get("shop.w1"), "Second");
        assert.equal(labels.get("shop.l1"), "shop.l1");
    });
});
