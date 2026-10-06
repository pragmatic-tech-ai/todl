import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime';
import { SolutionGraph, type SolutionGraphMember } from '../solution-graph.js';

const META = { uri: 'mm/meta.todl', text: 'namespace ea { concept Location { label : string; } }' };

class MemberFixture
{
    public static Make(id: string, srcs: { uri: string; text: string }[], baseIds: string[]): SolutionGraphMember
    {
        return { id, storage: new FakeStorage(), sources: srcs, baseIds, publishedBases: [] };
    }
}

describe('SolutionGraph visibility', () =>
{
    test('a bare reference in member A does not resolve to a same-named node in member B', async () =>
    {
        const A = { uri: 'a/a.todl', text: 'namespace a { import ea; model M { } concept Thing : Location { } }' };
        const B = { uri: 'b/b.todl', text: 'namespace b { import ea; concept Thing : Location { } }' };
        const g = new SolutionGraph();
        await g.Build([
            MemberFixture.Make('tech-architecture', [META], []),
            MemberFixture.Make('a', [A], ['tech-architecture']),
            MemberFixture.Make('b', [B], ['tech-architecture']),
        ]);
        assert.ok(g.Model.has('a.Thing') && g.Model.has('b.Thing'));
        for (const n of g.Model.allNodes().filter(x => String(x.id).startsWith('a.')))
        {
            for (const e of g.Model.outEdges(n.id))
            {
                assert.ok(!String(e.to).startsWith('b.'), `visibility leak: ${n.id} -> ${e.to}`);
            }
        }
    });
});
