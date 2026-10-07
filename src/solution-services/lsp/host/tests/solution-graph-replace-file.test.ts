import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime';
import type { Diagnostic } from '../../../../compiler-services/diagnostics/diagnostic.js';
import type { SourceFile } from '../../../../compiler-services/diagnostics/span.js';
import { SolutionGraph, type SolutionGraphMember } from '../solution-graph.js';

// Fixtures + the equivalence oracle shared by every case below. The gate is that an
// incremental ReplaceFile leaves the SAME graph (nodes, edges, per-uri diagnostics) a
// from-scratch full Build of the post-edit source set produces.
class ReplaceFileFixture
{
    // A two-file member: file A declares concept `T`; file B imports it, owns its own
    // concept `U`, and instantiates `T` (a CROSS-FILE reference A→B depends on).
    public static readonly FileAUri = 'm1/a.todl';
    public static readonly FileBUri = 'm1/b.todl';
    public static readonly SourceA = 'namespace n { concept T { label : string; } }';
    public static readonly SourceB = 'namespace p { import n; concept U { } model MB : n { T y { } } }';

    // Base-cascade fixture: a library member and two dependents that both reference it.
    public static readonly LibUri = 'lib/lib.todl';
    public static readonly Dep1Uri = 'd1/d1.todl';
    public static readonly Dep2Uri = 'd2/d2.todl';
    public static readonly SourceLib = 'namespace l { concept Base { label : string; } }';
    public static readonly SourceDep1 = 'namespace a { import l; model M1 : l { Base b1 { } } }';
    public static readonly SourceDep2 = 'namespace b { import l; model M2 : l { Base b2 { } } }';

    public static File(uri: string, text: string): SourceFile
    {
        return { uri, text };
    }

    public static Member(id: string, srcs: readonly SourceFile[], baseIds: readonly string[]): SolutionGraphMember
    {
        return { id, storage: new FakeStorage(), sources: [...srcs], baseIds: [...baseIds], publishedBases: [] };
    }

    public static TwoFileMember(a: string, b: string): SolutionGraphMember
    {
        return ReplaceFileFixture.Member('m1', [
            ReplaceFileFixture.File(ReplaceFileFixture.FileAUri, a),
            ReplaceFileFixture.File(ReplaceFileFixture.FileBUri, b),
        ], []);
    }

    private static NodeIds(g: SolutionGraph): string[]
    {
        return g.Model.allNodes().map(n => n.id).sort();
    }

    private static EdgeKeys(g: SolutionGraph): string[]
    {
        const keys: string[] = [];
        for (const n of g.Model.allNodes())
        {
            for (const e of g.Model.outEdges(n.id))
            {
                keys.push(`${String(e.from)}|${e.kind}|${String(e.via ?? '')}|${String(e.to)}`);
            }
        }
        return keys.sort();
    }

    private static DiagKey(d: Diagnostic): string
    {
        const at = d.span ? `${d.span.uri}@${d.span.start.line}:${d.span.start.column}` : '<none>';
        return `${d.code}|${d.severity}|${d.message}|${at}|${String(d.path ?? '')}`;
    }

    private static DiagLines(g: SolutionGraph): string[]
    {
        const lines: string[] = [];
        for (const [uri, diags] of g.DiagnosticsByUri())
        {
            for (const d of diags)
            {
                lines.push(`${uri}::${ReplaceFileFixture.DiagKey(d)}`);
            }
        }
        return lines.sort();
    }

    public static AssertGraphEquivalent(incremental: SolutionGraph, full: SolutionGraph): void
    {
        assert.deepEqual(ReplaceFileFixture.NodeIds(incremental), ReplaceFileFixture.NodeIds(full), 'node ids diverged');
        assert.deepEqual(ReplaceFileFixture.EdgeKeys(incremental), ReplaceFileFixture.EdgeKeys(full), 'edges diverged');
        assert.deepEqual(ReplaceFileFixture.DiagLines(incremental), ReplaceFileFixture.DiagLines(full), 'diagnostics diverged');
    }
}

describe('SolutionGraph.ReplaceFile', () =>
{
    test('adding a concept in file B equals a full compile', async () =>
    {
        const before = ReplaceFileFixture.TwoFileMember(ReplaceFileFixture.SourceA, ReplaceFileFixture.SourceB);
        const g = new SolutionGraph();
        await g.Build([before]);

        const afterB = ReplaceFileFixture.SourceB.replace('concept U { }', 'concept U { } concept Z { }');
        g.ReplaceFile(ReplaceFileFixture.FileBUri, [
            ReplaceFileFixture.File(ReplaceFileFixture.FileAUri, ReplaceFileFixture.SourceA),
            ReplaceFileFixture.File(ReplaceFileFixture.FileBUri, afterB),
        ]);

        const full = new SolutionGraph();
        await full.Build([ReplaceFileFixture.TwoFileMember(ReplaceFileFixture.SourceA, afterB)]);
        ReplaceFileFixture.AssertGraphEquivalent(g, full);
    });

    test('removing a concept from file B equals a full compile', async () =>
    {
        const before = ReplaceFileFixture.TwoFileMember(ReplaceFileFixture.SourceA, ReplaceFileFixture.SourceB);
        const g = new SolutionGraph();
        await g.Build([before]);

        const afterB = ReplaceFileFixture.SourceB.replace('concept U { } ', '');
        g.ReplaceFile(ReplaceFileFixture.FileBUri, [
            ReplaceFileFixture.File(ReplaceFileFixture.FileAUri, ReplaceFileFixture.SourceA),
            ReplaceFileFixture.File(ReplaceFileFixture.FileBUri, afterB),
        ]);

        const full = new SolutionGraph();
        await full.Build([ReplaceFileFixture.TwoFileMember(ReplaceFileFixture.SourceA, afterB)]);
        ReplaceFileFixture.AssertGraphEquivalent(g, full);
    });

    test('renaming a concept in file A referenced by file B re-validates B (cross-file)', async () =>
    {
        const before = ReplaceFileFixture.TwoFileMember(ReplaceFileFixture.SourceA, ReplaceFileFixture.SourceB);
        const g = new SolutionGraph();
        await g.Build([before]);

        const afterA = ReplaceFileFixture.SourceA.replace('concept T', 'concept T2');
        g.ReplaceFile(ReplaceFileFixture.FileAUri, [
            ReplaceFileFixture.File(ReplaceFileFixture.FileAUri, afterA),
            ReplaceFileFixture.File(ReplaceFileFixture.FileBUri, ReplaceFileFixture.SourceB),
        ]);

        const full = new SolutionGraph();
        await full.Build([ReplaceFileFixture.TwoFileMember(afterA, ReplaceFileFixture.SourceB)]);
        ReplaceFileFixture.AssertGraphEquivalent(g, full);
    });

    test('editing a base member file cascades to two dependents', async () =>
    {
        const lib = (text: string): SolutionGraphMember =>
            ReplaceFileFixture.Member('lib', [ReplaceFileFixture.File(ReplaceFileFixture.LibUri, text)], []);
        const dep1 = ReplaceFileFixture.Member('d1', [ReplaceFileFixture.File(ReplaceFileFixture.Dep1Uri, ReplaceFileFixture.SourceDep1)], ['lib']);
        const dep2 = ReplaceFileFixture.Member('d2', [ReplaceFileFixture.File(ReplaceFileFixture.Dep2Uri, ReplaceFileFixture.SourceDep2)], ['lib']);

        const g = new SolutionGraph();
        await g.Build([lib(ReplaceFileFixture.SourceLib), dep1, dep2]);

        const afterLib = ReplaceFileFixture.SourceLib.replace('label : string;', 'label : string; note : string;');
        g.ReplaceFile(ReplaceFileFixture.LibUri, [ReplaceFileFixture.File(ReplaceFileFixture.LibUri, afterLib)]);

        const full = new SolutionGraph();
        await full.Build([lib(afterLib), dep1, dep2]);
        ReplaceFileFixture.AssertGraphEquivalent(g, full);
    });
});
