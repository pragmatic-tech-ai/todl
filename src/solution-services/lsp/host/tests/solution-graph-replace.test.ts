import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime';
import { SolutionGraph, type SolutionGraphMember } from '../solution-graph.js';

const META = { uri: 'mm/meta.todl', text: 'namespace ea { concept Location { label : string; } }' };
const LIB = { uri: 'lib/lib.todl', text: 'namespace lib { import ea; taxonomy MS : represents Location { term azure { } } }' };
const LIB_EDITED = { uri: 'lib/lib.todl', text: 'namespace lib { import ea; taxonomy MS : represents Location { term azure { } term m365 { } } }' };
const ARCH = { uri: 'arch/a.todl', text: 'namespace app { import lib; model M : ea { } }' };

class ReplaceFixture
{
    public static Member(id: string, srcs: { uri: string; text: string }[], baseIds: string[]): SolutionGraphMember
    {
        return { id, storage: new FakeStorage(), sources: srcs, baseIds, publishedBases: [] };
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
    });

    test('editing a base member cascades to dependents', async () =>
    {
        const g = await ReplaceFixture.Built();
        let fired: string[] = [];
        g.Changed.subscribe(c => { fired = [...c.memberIds]; });
        g.ReplaceMember('microsoft', [LIB_EDITED]);
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
});
