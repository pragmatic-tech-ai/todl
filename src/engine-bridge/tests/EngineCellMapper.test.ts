import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { AccessDefault, AccessScope, Cypher } from "@pragmatic-tech-ai/graph";
import { Snapshot, type MirrorSnapshot } from "../../graph-api/index.js";
import { compilePackage, PackageKind } from "../../publish/publish.js";
import { PackageManifestBridge } from "../../solution-services/package-manager/package-manifest-bridge.js";
import { Domain } from "../../domain/domain.js";
import { MemoryPackageSource } from "../../domain/memory-package-source.js";
import type { CypherResultDto } from "../../graph-api/wire/index.js";
import type { MetadataSnapshot } from "../../domain/metadata-snapshot.js";
import { TodlNames } from "../TodlNames.js";
import { EngineCellMapper } from "../EngineCellMapper.js";
import { MessageFormat } from "../MessageFormat.js";
import { EngineFixture } from "./EngineFixture.js";
import { ManifestFixture } from "../../compiler-services/emit/tests/ManifestFixture.js";

/** Runs queries on a fixture's engine and maps the result cells. */
class MapperHarness
{
    public static readonly AllNodes = "MATCH (n) RETURN n";
    public static readonly NodeKey = "$node";
    public static readonly Text = "x";
    public static readonly MapField = "k";
    public static readonly PassThroughQuery = `RETURN 1 AS a, '${MapperHarness.Text}' AS b, null AS c, [1, 2] AS d, {${MapperHarness.MapField}: 1} AS e, {\`${MapperHarness.NodeKey}\`: 1} AS f, 2.5 AS g`;
    public static readonly MapKey = "$map";
    public static readonly NestedQuery = `MATCH (n) WITH collect(n) AS ns RETURN ns AS l, {${MapperHarness.MapField}: ns} AS m`;
    public static readonly ShopName = "shop";
    /** Two packages whose manifests both declare one term (the dependent's full closure): the term-dedup path. */
    public static readonly TwoPackagesName = "two-packages";
    public static readonly AspectsFixture = "aspects.todl";
    public static readonly OrderFixture = "order-fulfillment.todl";
    private static readonly Fixtures = [MapperHarness.AspectsFixture, MapperHarness.OrderFixture, MapperHarness.ShopName, MapperHarness.TwoPackagesName];
    public static readonly ParityTitle = "parity with Snapshot.of: {0}";
    public static readonly PassThroughTitle = "non-node cells pass through";
    public static readonly NestedTitle = "nested nodes in lists and maps are mapped";
    public static readonly LabelTitle = "label precedence: explicit label, then name, then id";
    public static readonly DedupTitle = "a term declared by two manifests maps once, first declaration winning";
    public static readonly SharedTerm = "a.K.T";
    public static readonly HiddenTitle = "a member the scope hides has no fields or refs entry; visible unset fields stay";
    public static readonly ShopWidget = "shop.Widget";
    public static readonly WidgetNodes = "MATCH (w:Widget) RETURN w";
    public static readonly FullId = "shop.w0";
    public static readonly UnsetId = "shop.w1";
    /** A property (name), a concept-typed field (home), a many-valued taxonomy field (kinds), a relationship (parts). */
    public static readonly HiddenMembers: readonly string[] = ["name", "home", "kinds", "parts"];
    public static readonly UnsetField = "count";
    public static readonly ReaderTitle = "relationship-held fields are judged by the reader given, property fields by the cell";
    public static readonly LinkField = "home";
    public static readonly PropertyField = "name";
    private static readonly MissingRowMessage = "{0}: {1} missing from the engine rows";
    private static readonly RowMessage = "{0}: {1}";
    private static readonly DuplicateRowsMessage = "{0}: one row per node";
    private static readonly TermRowsMessage = "{0}: term rows";
    private static readonly NodeCountMessage = "{0}: {1} nodes";
    private static readonly PackageA = { Id: "pkg.a", Uri: "a.todl", Text: "namespace a { concept A { } taxonomy K : represents A { term T { label = \"Tee\"; } } model MA : a { A a1 { } } }" };
    private static readonly PackageB = { Id: "pkg.b", Uri: "b.todl", Text: "namespace b { import a; model MB : a { a.A b1 { } } }" };
    private static readonly ShopUri = "shop.todl";
    public static readonly ExplicitId = "shop.w3";
    public static readonly ExplicitLabel = "Explicit";
    public static readonly NameOnlyId = "shop.w2";
    public static readonly NameOnlyLabel = "named";
    public static readonly LabelOnlyId = "shop.w1";
    public static readonly LabelOnlyLabel = "Second";
    public static readonly BareId = "shop.l1";
    private static readonly MinimumNodes = 1;
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
        const out = compilePackage([], [{ uri: MapperHarness.ShopUri, text: MapperHarness.Shop }], { id: MapperHarness.ShopModel, version: MapperHarness.ShopVersion });
        assert.ok(out.ok, JSON.stringify(out.errors));
        const domain = new Domain(new MemoryPackageSource([PackageManifestBridge.toResolved(out.package!)]));
        await domain.load({ model: MapperHarness.ShopModel, version: MapperHarness.ShopVersion });
        return domain.Snapshot;
    }

    /** pkg.a declares taxonomy K; pkg.b depends on it, so pkg.b's manifest carries K's term too. */
    public static async TwoPackagesGraph(): Promise<MetadataSnapshot>
    {
        const { PackageA, PackageB, ShopVersion } = MapperHarness;
        const a = compilePackage([], [{ uri: PackageA.Uri, text: PackageA.Text }], { id: PackageA.Id, version: ShopVersion });
        assert.ok(a.ok, JSON.stringify(a.errors));
        const b = compilePackage([a.package!.document], [{ uri: PackageB.Uri, text: PackageB.Text }], { id: PackageB.Id, version: ShopVersion },
            [{ kind: PackageKind.Library, id: PackageA.Id, version: ShopVersion }]);
        assert.ok(b.ok, JSON.stringify(b.errors));
        const domain = new Domain(new MemoryPackageSource([PackageManifestBridge.toResolved(a.package!), PackageManifestBridge.toResolved(b.package!)]));
        await domain.load({ model: PackageB.Id, version: ShopVersion });
        return domain.Snapshot;
    }

    public static async Graph(fixture: string): Promise<MetadataSnapshot>
    {
        switch (fixture)
        {
            case MapperHarness.ShopName:
                return MapperHarness.ShopGraph();
            case MapperHarness.TwoPackagesName:
                return MapperHarness.TwoPackagesGraph();
            default:
                return ManifestFixture.Graph(ManifestFixture.Repo([fixture]));
        }
    }

    public static async Run(fixture: string, query: string): Promise<{ graph: MetadataSnapshot; mapped: CypherResultDto; raw: Cypher.CypherResultDto }>
    {
        return MapperHarness.RunOn(await MapperHarness.Graph(fixture), query);
    }

    public static async RunOn(graph: MetadataSnapshot, query: string): Promise<{ graph: MetadataSnapshot; mapped: CypherResultDto; raw: Cypher.CypherResultDto }>
    {
        const engine = await EngineFixture.Open(EngineFixture.Describe(graph));
        try
        {
            const result = await new Cypher.CypherEngine(engine).Execute(AccessScope.System, query);
            const raw = Cypher.CypherEngine.ToDto(result);
            // the result's own scope (System) answers which members are hidden: none
            const reader = await engine.BeginRead(AccessScope.System);
            try
            {
                return { graph, mapped: new EngineCellMapper(graph).MapResult(raw, reader), raw };
            }
            finally
            {
                reader.dispose();
            }
        }
        finally
        {
            await engine.dispose();
        }
    }

    /**
     * `WidgetNodes` on the shop graph under a scope hiding `HiddenMembers` on Widget, mapped with the scoped reader (or,
     * with `system`, with a System reader that hides nothing: the wrong reader for that result).
     */
    public static async RunHidden(system = false): Promise<{ graph: MetadataSnapshot; byId: Map<string, MirrorSnapshot> }>
    {
        const graph = await MapperHarness.ShopGraph();
        const engine = await EngineFixture.Open(EngineFixture.Describe(graph));
        try
        {
            const scope = AccessScope.Build({ Default: AccessDefault.Allow, Hidden: new Map([[MapperHarness.ShopWidget, new Set(MapperHarness.HiddenMembers)]]) });
            const raw = Cypher.CypherEngine.ToDto(await new Cypher.CypherEngine(engine).Execute(scope, MapperHarness.WidgetNodes));
            const reader = await engine.BeginRead(system ? AccessScope.System : scope);
            try
            {
                const mapped = new EngineCellMapper(graph).MapResult(raw, reader);
                const byId = new Map<string, MirrorSnapshot>();
                for (const row of mapped.Rows)
                {
                    const snap = (row[0] as unknown as Record<string, MirrorSnapshot>)[MapperHarness.NodeKey]!;
                    byId.set(snap.id, snap);
                }
                return { graph, byId };
            }
            finally
            {
                reader.dispose();
            }
        }
        finally
        {
            await engine.dispose();
        }
    }

    /** The wire snapshot of every declared term: label is the fixed label else the id; refs hold the broader term. */
    public static DeclaredTerms(graph: MetadataSnapshot): Map<string, MirrorSnapshot>
    {
        const terms = new Map<string, MirrorSnapshot>();
        for (const manifest of graph.manifests)
        {
            for (const taxonomy of manifest.taxonomies())
            {
                for (const term of taxonomy.getTerms())
                {
                    if (terms.has(term.id)) continue;
                    const field = term.concept?.getField(TodlNames.Label);
                    const fixed = field === undefined ? undefined : term.getFixedValue(field);
                    terms.set(term.id, {
                        id: term.id,
                        concept: TodlNames.Term,
                        label: fixed === undefined ? term.id : String(fixed),
                        fields: {},
                        refs: term.broader === undefined ? {} : { [TodlNames.Broader]: [term.broader.id] },
                    });
                }
            }
        }
        return terms;
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
        assert.equal(byId.size, mapped.Rows.length, MessageFormat.Format(MapperHarness.DuplicateRowsMessage, fixture));
        const nodes = graph.allNodes();
        for (const node of nodes)
        {
            const got = byId.get(node.id);
            assert.ok(got !== undefined, MessageFormat.Format(MapperHarness.MissingRowMessage, fixture, node.id));
            assert.deepEqual(got, Snapshot.of(graph.reflect(node)), MessageFormat.Format(MapperHarness.RowMessage, fixture, node.id));
        }
        // Terms are not heap nodes, so Snapshot.of cannot project them; their rows are asserted exactly against the
        // terms the manifests declare (the engine seeds each declared term once, first declaration winning).
        const terms = MapperHarness.DeclaredTerms(graph);
        const termRows = [...byId.values()].filter((snap) => graph.getNode(snap.id) === undefined);
        assert.deepEqual(termRows.map((snap) => snap.id).sort(), [...terms.keys()].sort(), MessageFormat.Format(MapperHarness.TermRowsMessage, fixture));
        for (const row of termRows)
        {
            assert.deepEqual(row, terms.get(row.id), MessageFormat.Format(MapperHarness.RowMessage, fixture, row.id));
        }
        assert.ok(nodes.length >= MapperHarness.MinimumNodes, MessageFormat.Format(MapperHarness.NodeCountMessage, fixture, String(nodes.length)));
        return nodes.length;
    }
}

describe("EngineCellMapper", () =>
{
    for (const fixture of MapperHarness.FixtureNames)
    {
        test(MessageFormat.Format(MapperHarness.ParityTitle, fixture), async () =>
        {
            await MapperHarness.CheckParity(fixture);
        });
    }

    test(MapperHarness.PassThroughTitle, async () =>
    {
        const { mapped } = await MapperHarness.Run(MapperHarness.AspectsFixture, MapperHarness.PassThroughQuery);
        assert.deepEqual(mapped.Rows[0], [1, MapperHarness.Text, null, [1, 2], { [MapperHarness.MapField]: 1 }, { [MapperHarness.MapKey]: { [MapperHarness.NodeKey]: 1 } }, 2.5]);
    });

    test(MapperHarness.NestedTitle, async () =>
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
        assert.deepEqual(map[MapperHarness.MapField], list);
    });

    test(MapperHarness.DedupTitle, async () =>
    {
        const graph = await MapperHarness.TwoPackagesGraph();
        const declaring = graph.manifests.filter((m) => m.taxonomies().some((t) => t.getTerms().some((term) => term.id === MapperHarness.SharedTerm)));
        assert.equal(declaring.length, 2);
        assert.deepEqual([...MapperHarness.DeclaredTerms(graph).keys()], [MapperHarness.SharedTerm]);
        await MapperHarness.CheckParity(MapperHarness.TwoPackagesName);
    });

    test(MapperHarness.HiddenTitle, async () =>
    {
        const { graph, byId } = await MapperHarness.RunHidden();
        const full = byId.get(MapperHarness.FullId)!;
        const expected = Snapshot.of(graph.reflect(graph.getNode(MapperHarness.FullId)!));
        for (const member of MapperHarness.HiddenMembers)
        {
            assert.ok(member in expected.fields || member in expected.refs, member);
            assert.equal(member in full.fields, false, member);
            assert.equal(member in full.refs, false, member);
            delete expected.fields[member];
            delete expected.refs[member];
        }
        // the hidden name no longer labels the node; everything else is exactly Snapshot.of
        assert.deepEqual({ ...full, label: expected.label }, expected);
        const unset = byId.get(MapperHarness.UnsetId)!;
        assert.ok(MapperHarness.UnsetField in unset.fields);
        assert.equal(unset.fields[MapperHarness.UnsetField]!.value, undefined);
    });

    test(MapperHarness.ReaderTitle, async () =>
    {
        const { byId } = await MapperHarness.RunHidden(true);
        const full = byId.get(MapperHarness.FullId)!;
        // the cell itself withholds the hidden property; only the reader can say a link field is hidden, so a reader
        // that hides nothing keeps it (which is why the reader is a required argument)
        assert.equal(MapperHarness.PropertyField in full.fields, false);
        assert.equal(MapperHarness.LinkField in full.fields, true);
    });

    test(MapperHarness.LabelTitle, async () =>
    {
        const { mapped } = await MapperHarness.RunOn(await MapperHarness.ShopGraph(), MapperHarness.AllNodes);
        const labels = new Map<string, string>();
        for (const row of mapped.Rows)
        {
            const snap = (row[0] as unknown as Record<string, MirrorSnapshot>)[MapperHarness.NodeKey]!;
            labels.set(snap.id, snap.label);
        }
        assert.equal(labels.get(MapperHarness.ExplicitId), MapperHarness.ExplicitLabel);
        assert.equal(labels.get(MapperHarness.NameOnlyId), MapperHarness.NameOnlyLabel);
        assert.equal(labels.get(MapperHarness.LabelOnlyId), MapperHarness.LabelOnlyLabel);
        assert.equal(labels.get(MapperHarness.BareId), MapperHarness.BareId);
    });
});
