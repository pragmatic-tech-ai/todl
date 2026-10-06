import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime';
import { SolutionGraph, type SolutionGraphMember } from '../solution-graph.js';

const META = { uri: 'mm/meta.todl', text: 'namespace ea { concept Location { label : string; } }' };
const B_SRC = { uri: 'b/b.todl', text: 'namespace b { import ea; concept Thing : Location { } concept Widget : Location { } }' };

class MemberFixture
{
    public static Make(id: string, srcs: { uri: string; text: string }[], baseIds: string[]): SolutionGraphMember
    {
        return { id, storage: new FakeStorage(), sources: srcs, baseIds, publishedBases: [] };
    }

    public static async Build(aText: string, aBaseIds: string[]): Promise<SolutionGraph>
    {
        const g = new SolutionGraph();
        await g.Build([
            MemberFixture.Make('tech-architecture', [META], []),
            MemberFixture.Make('b', [B_SRC], ['tech-architecture']),
            MemberFixture.Make('a', [{ uri: 'a/a.todl', text: aText }], aBaseIds),
        ]);
        return g;
    }

    public static Targets(g: SolutionGraph, id: string): string[]
    {
        return g.Model.outEdges(id as never).map(e => String(e.to));
    }
}

describe('SolutionGraph visibility', () =>
{
    test('a bare reference in member A does not resolve to a node only in sibling B', async () =>
    {
        const g = await MemberFixture.Build(
            'namespace a { import ea; concept Thing : Location { } concept Gadget : Widget { } }',
            ['tech-architecture']);
        assert.ok(g.Model.has('a.Thing') && g.Model.has('b.Thing'), 'same local name coexists, namespace-distinct');
        assert.ok(g.Model.has('a.Gadget'));
        for (const to of MemberFixture.Targets(g, 'a.Gadget'))
        {
            assert.ok(!to.startsWith('b.'), `visibility leak: a.Gadget -> ${to}`);
        }
        const messages = (g.DiagnosticsByUri().get('a/a.todl') ?? []).map(d => d.message);
        assert.ok(
            messages.some(m => m.includes('"Widget"') && m.includes('not imported')),
            `expected an unreachable-reference diagnostic, got: ${messages.join(' | ')}`);
    });

    test('positive control: with import b and b as a base, a.Gadget -> b.Widget appears', async () =>
    {
        const g = await MemberFixture.Build(
            'namespace a { import ea; import b; concept Gadget : Widget { } }',
            ['b']);
        const targets = MemberFixture.Targets(g, 'a.Gadget');
        assert.ok(targets.includes('b.Widget'), `expected edge to b.Widget, got: ${targets.join(', ')}`);
    });
});
