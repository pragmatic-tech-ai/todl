import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { FakeStorage } from "@pragmatic-tech-ai/todl-runtime";
import type { Position } from "vscode-languageserver-types";
import { AnalysisSnapshot } from "../analysis-snapshot.js";
import type { GraphSlice } from "../graph-slice.js";
import { HoverProvider } from "../hover-provider.js";
import { NavigationProvider } from "../navigation-provider.js";
import { CompletionProvider } from "../completion-provider.js";
import { check } from "../../../../compiler-services/api.js";
import { toJSON, type TodlDocument } from "../../../../compiler-services/emit/json.js";
import { preludeDocument } from "../../../../compiler-services/stdlib/prelude.js";
import type { SourceFile } from "../../../../compiler-services/diagnostics/span.js";
import { SolutionGraph, type SolutionGraphMember } from "../../host/solution-graph.js";

// The project under test: member A (namespace acme.a) over a meta-model base (ea). It
// references its own symbol (Site), a base symbol (Location), and — the visibility probe
// — a name (Secret) that exists ONLY in sibling member B, which shares A's namespace. A
// project-scoped compile must NOT resolve Secret; the shared whole-solution graph DOES
// contain acme.a.Secret, so parity depends on FromGraph scoping it out.
class Fixture
{
    public static readonly MetaUri = "mm/meta.todl";
    public static readonly AUri = "a/a.todl";
    public static readonly BUri = "b/b.todl";

    public static readonly MetaSource = "namespace ea { concept Location { label : string; } concept Region : Location { } }";
    public static readonly ASource = [
        "namespace acme.a {",
        "  import ea;",
        "  concept Site : Location { }",
        "  concept Hub : Site { }",
        "  concept Gate : Secret { }",
        "}",
    ].join("\n");
    // Sibling B shares A's namespace and declares the Secret that A (wrongly) references.
    public static readonly BSource = "namespace acme.a { import ea; concept Secret : Location { } }";

    public static readonly MetaDoc: TodlDocument = toJSON(check([{ uri: Fixture.MetaUri, text: Fixture.MetaSource }]).model);

    public static ASources(): SourceFile[]
    {
        return [{ uri: Fixture.AUri, text: Fixture.ASource }];
    }

    // Build the shared graph with members ordered so A loads before its same-namespace
    // sibling B (mm → A → B), mirroring the host's topological assembly.
    public static async Graph(): Promise<SolutionGraph>
    {
        const g = new SolutionGraph();
        await g.Build([
            Fixture.Member("mm", [{ uri: Fixture.MetaUri, text: Fixture.MetaSource }], []),
            Fixture.Member("acme.a", Fixture.ASources(), ["mm"]),
            Fixture.Member("acme.b", [{ uri: Fixture.BUri, text: Fixture.BSource }], ["mm"]),
        ]);
        return g;
    }

    private static Member(id: string, sources: SourceFile[], baseIds: string[]): SolutionGraphMember
    {
        return { id, storage: new FakeStorage(id + "/"), sources, baseIds, publishedBases: [] };
    }

    // Assemble A's GraphSlice exactly as SolutionLanguageService.GraphSliceFor does:
    // OwnIds are the nodes provenance-attributed to A's own file, VisibleIds add the
    // prelude + A's declared bases' nodes.
    public static SliceFor(g: SolutionGraph, bases: readonly TodlDocument[]): GraphSlice
    {
        const ownFiles = new Set<string>(Fixture.ASources().map((s) => s.uri));
        const ownIds = new Set<string>();
        for (const [nodeId, uri] of g.Provenance) if (ownFiles.has(uri)) ownIds.add(nodeId);
        const visibleIds = new Set<string>(ownIds);
        for (const node of preludeDocument().nodes) visibleIds.add(node.id);
        for (const base of bases) for (const node of base.nodes) visibleIds.add(node.id);
        const diagnosticsByUri = g.DiagnosticsByUri();
        return {
            Model: g.Model,
            DiagnosticsByUri: diagnosticsByUri,
            WholeModelDiagnostics: diagnosticsByUri.get(SolutionGraph.ModelScopeUri) ?? [],
            VisibleIds: visibleIds,
            OwnIds: ownIds,
        };
    }

    // The 0-based editor Position of the `skip`-th occurrence of `needle` in A's source.
    public static At(needle: string, skip = 0): Position
    {
        const lines = Fixture.ASource.split("\n");
        let remaining = skip;
        for (let line = 0; line < lines.length; line += 1)
        {
            const col = lines[line]!.indexOf(needle);
            if (col >= 0)
            {
                if (remaining === 0) return { line, character: col };
                remaining -= 1;
            }
        }
        throw new Error(`needle not found: ${needle}`);
    }
}

// The two snapshots under comparison: the legacy per-request compile and the shared-graph
// path, built from IDENTICAL sources so any difference is a scoping/parity defect.
class Pair
{
    public readonly Build: AnalysisSnapshot;
    public readonly Graph: AnalysisSnapshot;
    public readonly SharedModelHasSecret: boolean;
    public readonly ScopedModelHasSecret: boolean;

    private constructor(build: AnalysisSnapshot, graph: AnalysisSnapshot, shared: boolean, scoped: boolean)
    {
        this.Build = build;
        this.Graph = graph;
        this.SharedModelHasSecret = shared;
        this.ScopedModelHasSecret = scoped;
    }

    public static async Make(): Promise<Pair>
    {
        const bases = [Fixture.MetaDoc];
        const build = AnalysisSnapshot.Build(Fixture.ASources(), bases);
        const g = await Fixture.Graph();
        const slice = Fixture.SliceFor(g, bases);
        const graph = AnalysisSnapshot.FromGraph(Fixture.ASources(), slice);
        return new Pair(build, graph, g.Model.has("acme.a.Secret"), graph.Model.has("acme.a.Secret"));
    }
}

class Compare
{
    private static readonly Hover = new HoverProvider();
    private static readonly Nav = new NavigationProvider();

    public static Hovers(pair: Pair, pos: Position): void
    {
        assert.deepEqual(
            Compare.Hover.HoverAt(pair.Graph, Fixture.AUri, pos),
            Compare.Hover.HoverAt(pair.Build, Fixture.AUri, pos));
    }

    public static Definitions(pair: Pair, pos: Position): void
    {
        assert.deepEqual(
            Compare.Nav.DefinitionAt(pair.Graph, Fixture.AUri, pos),
            Compare.Nav.DefinitionAt(pair.Build, Fixture.AUri, pos));
    }

    public static References(pair: Pair, pos: Position): void
    {
        assert.deepEqual(
            Compare.Nav.ReferencesAt(pair.Graph, Fixture.AUri, pos, true),
            Compare.Nav.ReferencesAt(pair.Build, Fixture.AUri, pos, true));
    }

    // Diagnostics compared order-independently per file (Build and the graph may bucket
    // in a different order), keyed by code + range.
    public static Diagnostics(pair: Pair): void
    {
        const keys = new Set<string>([...pair.Build.DiagnosticsByUri.keys(), ...pair.Graph.DiagnosticsByUri.keys()]);
        for (const uri of keys)
        {
            assert.deepEqual(Compare.Sorted(pair.Graph, uri), Compare.Sorted(pair.Build, uri), `diagnostics diverge for ${uri}`);
        }
    }

    private static Sorted(a: AnalysisSnapshot, uri: string): string[]
    {
        return [...(a.DiagnosticsByUri.get(uri) ?? [])]
            .map((d) => `${String(d.code)}@${d.range.start.line}:${d.range.start.character}-${d.range.end.line}:${d.range.end.character}:${d.message}`)
            .sort();
    }
}

// A SEPARATE fixture for the schema-gating case. The sibling B (same namespace acme.a)
// is loaded BEFORE A, so the shared graph actually RESOLVES A's `Gate : Secret` supertype
// edge into B's out-of-scope concept — the condition under which an ungated schemaOf /
// effectiveSchema would merge B's `extends` and inherited members into A's view. A scoped
// Build never resolves Secret, so Gate roots at Element with none of Secret's members.
class GateFixture
{
    public static readonly MetaUri = "mm/meta.todl";
    public static readonly AUri = "a/a.todl";
    public static readonly BUri = "b/b.todl";

    public static readonly MetaSource = "namespace ea { concept Location { label : string; } }";
    public static readonly ASource = [
        "namespace acme.a {",
        "  import ea;",
        "  concept Hub { }",
        "  concept Gate : Secret { }",
        "  Location generic { }",
        "  Hub h { }",
        "  Gate g { peer = & }",
        "}",
    ].join("\n");
    // Sibling B owns the out-of-scope supertype Secret, which declares an inherited
    // relationship `peer` — the member whose leakage into Gate's schema we guard against.
    public static readonly BSource = "namespace acme.a { import ea; concept Secret : Location { relationship peer -> Location []; } }";

    public static readonly MetaDoc: TodlDocument = toJSON(check([{ uri: GateFixture.MetaUri, text: GateFixture.MetaSource }]).model);

    public static ASources(): SourceFile[]
    {
        return [{ uri: GateFixture.AUri, text: GateFixture.ASource }];
    }

    // B BEFORE A, so A's Gate : Secret resolves in the shared graph.
    public static async Graph(): Promise<SolutionGraph>
    {
        const g = new SolutionGraph();
        await g.Build([
            { id: "mm", storage: new FakeStorage("mm/"), sources: [{ uri: GateFixture.MetaUri, text: GateFixture.MetaSource }], baseIds: [], publishedBases: [] },
            { id: "acme.b", storage: new FakeStorage("b/"), sources: [{ uri: GateFixture.BUri, text: GateFixture.BSource }], baseIds: ["mm"], publishedBases: [] },
            { id: "acme.a", storage: new FakeStorage("a/"), sources: GateFixture.ASources(), baseIds: ["mm"], publishedBases: [] },
        ]);
        return g;
    }

    public static SliceFor(g: SolutionGraph, bases: readonly TodlDocument[]): GraphSlice
    {
        const ownFiles = new Set<string>(GateFixture.ASources().map((s) => s.uri));
        const ownIds = new Set<string>();
        for (const [nodeId, uri] of g.Provenance) if (ownFiles.has(uri)) ownIds.add(nodeId);
        const visibleIds = new Set<string>(ownIds);
        for (const node of preludeDocument().nodes) visibleIds.add(node.id);
        for (const base of bases) for (const node of base.nodes) visibleIds.add(node.id);
        const diagnosticsByUri = g.DiagnosticsByUri();
        return {
            Model: g.Model,
            DiagnosticsByUri: diagnosticsByUri,
            WholeModelDiagnostics: diagnosticsByUri.get(SolutionGraph.ModelScopeUri) ?? [],
            VisibleIds: visibleIds,
            OwnIds: ownIds,
        };
    }

    // The 0-based editor Position just AFTER the sole `&` (the ref-value slot), and the
    // Position of the reference to concept `Gate` in the `Gate g` record header.
    public static RefValuePosition(): Position
    {
        return GateFixture.LocateAfter("peer = &", "&");
    }

    public static GateReferencePosition(): Position
    {
        return GateFixture.LocateAfter("  Gate g", "Gate");
    }

    private static LocateAfter(lineNeedle: string, token: string): Position
    {
        const lines = GateFixture.ASource.split("\n");
        for (let line = 0; line < lines.length; line += 1)
        {
            const at = lines[line]!.indexOf(lineNeedle);
            if (at >= 0) return { line, character: at + lines[line]!.slice(at).indexOf(token) + token.length };
        }
        throw new Error(`line not found: ${lineNeedle}`);
    }

    public static async Pair(): Promise<{ build: AnalysisSnapshot; graph: AnalysisSnapshot }>
    {
        const bases = [GateFixture.MetaDoc];
        const build = AnalysisSnapshot.Build(GateFixture.ASources(), bases);
        const g = await GateFixture.Graph();
        const graph = AnalysisSnapshot.FromGraph(GateFixture.ASources(), GateFixture.SliceFor(g, bases));
        return { build, graph };
    }
}

describe("AnalysisSnapshot.FromGraph parity with Build", () =>
{
    test("hover matches at an own symbol, a base symbol, and the cross-member leak", async () =>
    {
        const pair = await Pair.Make();
        Compare.Hovers(pair, Fixture.At("Location"));   // base symbol
        Compare.Hovers(pair, Fixture.At("Site", 1));    // own symbol (reference, not the decl)
        Compare.Hovers(pair, Fixture.At("Secret"));     // leak: must be unresolved in both
    });

    test("definition matches, including null for a base symbol and for the leak", async () =>
    {
        const pair = await Pair.Make();
        Compare.Definitions(pair, Fixture.At("Location"));
        Compare.Definitions(pair, Fixture.At("Site", 1));
        Compare.Definitions(pair, Fixture.At("Secret"));
    });

    test("references match for an own symbol", async () =>
    {
        const pair = await Pair.Make();
        Compare.References(pair, Fixture.At("Site", 1));
    });

    test("DiagnosticsByUri matches per file", async () =>
    {
        const pair = await Pair.Make();
        Compare.Diagnostics(pair);
    });

    test("the scoping is load-bearing: the shared graph sees acme.a.Secret but the scoped view does not", async () =>
    {
        const pair = await Pair.Make();
        assert.equal(pair.SharedModelHasSecret, true, "sibling B contributes acme.a.Secret to the shared graph");
        assert.equal(pair.ScopedModelHasSecret, false, "FromGraph scopes acme.a.Secret out of A's view");
    });

    // schemaOf / effectiveSchema gating: with the sibling loaded first, the shared graph
    // resolves Gate's out-of-scope supertype Secret; FromGraph must still match Build,
    // which leaves Secret unresolved — so neither hover nor completion merges Secret's
    // `extends` or its inherited `peer` relationship into Gate.
    test("hover on a concept whose supertype is an out-of-scope sibling does not merge that supertype", async () =>
    {
        const { build, graph } = await GateFixture.Pair();
        const pos = GateFixture.GateReferencePosition();
        assert.deepEqual(
            new HoverProvider().HoverAt(graph, GateFixture.AUri, pos),
            new HoverProvider().HoverAt(build, GateFixture.AUri, pos));
    });

    test("completion in a record of such a concept does not merge the out-of-scope inherited member", async () =>
    {
        const { build, graph } = await GateFixture.Pair();
        const pos = GateFixture.RefValuePosition();
        const labels = (a: AnalysisSnapshot): string[] =>
            new CompletionProvider().CompletionsAt(a, GateFixture.AUri, pos).map((i) => i.label).sort();
        assert.deepEqual(labels(graph), labels(build));
    });
});
