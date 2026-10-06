import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime';
import { Severity } from '../../../../compiler-services/diagnostics/diagnostic.js';
import { SolutionGraph, type SolutionGraphChange, type SolutionGraphMember } from '../solution-graph.js';

const META = { uri: 'mm/meta.todl', text: 'namespace ea { concept Location { label : string; } concept Place { at : Location?; } }' };
const LIB = { uri: 'lib/lib.todl', text: 'namespace lib { import ea; taxonomy MS : represents Location { term azure { } } }' };
const LIB_EDITED = { uri: 'lib/lib.todl', text: 'namespace lib { import ea; taxonomy MS : represents Location { term azure { } term m365 { } } }' };
const ARCH = { uri: 'arch/a.todl', text: 'namespace app { import ea; import lib; model M : ea { Place p { at = lib.MS.azure; } } }' };
const ARCH_BAD = { uri: 'arch/a.todl', text: 'namespace app { import ea; import lib; model M : ea { Place p { at = lib.MS.nowhere; } } }' };
const LIB_BAD = { uri: 'lib/lib.todl', text: 'namespace lib { import ea; taxonomy MS : represents Location { term azure { } } Place q { at = lib.MS.missing; } }' };
const OTHER = { uri: 'other/o.todl', text: 'namespace other { import ea; model O : ea { } }' };

class ReplaceFixture
{
    public static Member(id: string, srcs: { uri: string; text: string }[], baseIds: string[]): SolutionGraphMember
    {
        return { id, storage: new FakeStorage(), sources: srcs, baseIds, publishedBases: [] };
    }

    public static ErrorCount(g: SolutionGraph, uri: string): number
    {
        return (g.DiagnosticsByUri().get(uri) ?? []).filter(d => d.severity === Severity.Error).length;
    }

    // The full edge set of a graph, keyed by endpoints + kind + realising member node, so
    // an edge regression (same node COUNT, different edges) bites — not just node presence.
    public static EdgeKeys(g: SolutionGraph): string[]
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

    public static async Built(arch: { uri: string; text: string } = ARCH): Promise<SolutionGraph>
    {
        const g = new SolutionGraph();
        await g.Build([
            ReplaceFixture.Member('tech-architecture', [META], []),
            ReplaceFixture.Member('microsoft', [LIB], ['tech-architecture']),
            ReplaceFixture.Member('arch', [arch], ['microsoft']),
        ]);
        return g;
    }
}

describe('SolutionGraph.ReplaceMember', () =>
{
    test('replacing a member yields the same graph as a full rebuild', async () =>
    {
        const edited = { uri: 'arch/a.todl', text: 'namespace app { import lib; model M : ea { } model N : ea { } }' };
        const g = await ReplaceFixture.Built();
        g.ReplaceMember('arch', [edited]);
        const rebuilt = await ReplaceFixture.Built(edited);
        for (const n of rebuilt.Model.allNodes())
        {
            assert.ok(g.Model.has(n.id), `missing ${n.id}`);
        }
        assert.equal(g.Model.allNodes().length, rebuilt.Model.allNodes().length);
        // Edge-set parity too, so a regressed edge set with the same node count is caught.
        assert.deepEqual(ReplaceFixture.EdgeKeys(g), ReplaceFixture.EdgeKeys(rebuilt));
    });

    test('editing a base member cascades to dependents', async () =>
    {
        const g = await ReplaceFixture.Built();
        const emits: SolutionGraphChange[] = [];
        g.Changed.subscribe(c => { emits.push(c); });
        g.ReplaceMember('microsoft', [LIB_EDITED]);
        assert.equal(emits.length, 1, 'emitted exactly once');
        assert.deepEqual([...emits[0].memberIds].sort(), ['arch', 'microsoft']);
        const fired = [...emits[0].memberIds];
        assert.ok(g.Model.has('app.p'), 'dependent node reloaded');
        const targets = g.Model.outEdges('app.p' as never).map(e => String(e.to));
        assert.ok(targets.includes('lib.MS.azure'), 'arch->lib reference resolves');
        assert.ok(g.Model.has('lib.MS.m365'), 'new base node present');
        assert.ok(fired.includes('microsoft') && fired.includes('arch'), 'cascade reloaded dependents');
        assert.ok(!fired.includes('tech-architecture'));
        assert.deepEqual(g.Model.danglingRefs(), []);
    });

    test('re-replacing with identical source is idempotent', async () =>
    {
        const g = await ReplaceFixture.Built();
        const before = g.Model.allNodes().length;
        g.ReplaceMember('arch', [ARCH]);
        g.ReplaceMember('arch', [ARCH]);
        assert.equal(g.Model.allNodes().length, before);
    });

    test('DependentsOf is transitive and empty for a leaf', async () =>
    {
        const g = await ReplaceFixture.Built();
        assert.deepEqual([...g.DependentsOf('microsoft')], ['arch']);
        assert.deepEqual([...g.DependentsOf('tech-architecture')].sort(), ['arch', 'microsoft']);
        assert.deepEqual([...g.DependentsOf('arch')], []);
    });

    test('no stale OriginOf entries after replace', async () =>
    {
        const g = await ReplaceFixture.Built();
        g.ReplaceMember('microsoft', [LIB_EDITED]);
        for (const key of g.OriginOf.keys())
        {
            assert.ok(g.Model.has(key), `stale OriginOf entry ${key}`);
        }
    });

    test('replace drops the replaced member stale diagnostics', async () =>
    {
        const g = new SolutionGraph();
        await g.Build([
            ReplaceFixture.Member('tech-architecture', [META], []),
            ReplaceFixture.Member('microsoft', [LIB], ['tech-architecture']),
            ReplaceFixture.Member('arch', [ARCH_BAD], ['microsoft']),
        ]);
        assert.ok(ReplaceFixture.ErrorCount(g, 'arch/a.todl') > 0, 'bad source reports an error');
        g.ReplaceMember('arch', [ARCH]);
        assert.equal(ReplaceFixture.ErrorCount(g, 'arch/a.todl'), 0, 'old diagnostic gone');
    });

    test('replace keeps diagnostics of unaffected members', async () =>
    {
        const g = new SolutionGraph();
        await g.Build([
            ReplaceFixture.Member('tech-architecture', [META], []),
            ReplaceFixture.Member('microsoft', [LIB_BAD], ['tech-architecture']),
            ReplaceFixture.Member('other', [OTHER], ['tech-architecture']),
        ]);
        const before = ReplaceFixture.ErrorCount(g, 'lib/lib.todl');
        assert.ok(before > 0, 'base source reports an error');
        g.ReplaceMember('other', [OTHER]);
        assert.equal(ReplaceFixture.ErrorCount(g, 'lib/lib.todl'), before, 'unaffected diagnostics retained');
    });

    test('a replace whose source throws mid-load repairs to a consistent graph and still emits', async () =>
    {
        const g = await ReplaceFixture.Built();
        const before = g.Model.allNodes().length;
        assert.ok(g.Model.has('app.p'));
        const emits: SolutionGraphChange[] = [];
        g.Changed.subscribe(c => { emits.push(c); });

        // Two `concept Dup` in one member's sources — builder.commit throws mid-reload, the
        // routine transient while a user is typing a second declaration.
        const dup = { uri: 'arch/a.todl', text: 'namespace app { import ea; concept Dup { } concept Dup { } }' };
        assert.doesNotThrow(() => g.ReplaceMember('arch', [dup]));

        assert.ok(emits.length >= 1, 'a Changed event fired despite the failed edit');
        assert.ok(g.Model.has('app.p'), 'prior arch node restored, not silently stripped');
        assert.equal(g.Model.allNodes().length, before, 'node set restored to last-good');
        assert.deepEqual(g.Model.danglingRefs(), [], 'graph left consistent');
    });
});
