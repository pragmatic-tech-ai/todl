import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime';
import { SolutionGraph, type SolutionGraphMember } from '../solution-graph.js';

class ProvenanceFixture
{
    public static readonly FileA = 'a.todl';
    public static readonly FileB = 'b.todl';
    // Provenance homes every minted node to its authoring file — concept declarations
    // included (homed since Task P) — so each file contributes its concept and its model
    // instance.
    private static readonly SourceA = 'namespace n { concept T { } model MA : n { T x { } } }';
    private static readonly SourceB = 'namespace p { import n; model MB : n { T y { } } }';

    public static Member(): SolutionGraphMember
    {
        return {
            id: 'm1',
            storage: new FakeStorage(),
            sources: [
                { uri: ProvenanceFixture.FileA, text: ProvenanceFixture.SourceA },
                { uri: ProvenanceFixture.FileB, text: ProvenanceFixture.SourceB },
            ],
            baseIds: [],
            publishedBases: [],
        };
    }

    public static IdEndingWith(g: SolutionGraph, suffix: string): string
    {
        return [...g.Model.allNodes()].find(n => n.id.endsWith(suffix))!.id;
    }
}

test('Provenance maps each node to its authoring file uri', async () =>
{
    const graph = new SolutionGraph();
    await graph.Build([ProvenanceFixture.Member()]);
    const prov = graph.Provenance;
    const xId = ProvenanceFixture.IdEndingWith(graph, '.x');
    const yId = ProvenanceFixture.IdEndingWith(graph, '.y');
    assert.ok(prov.get(xId)!.endsWith(ProvenanceFixture.FileA));
    assert.ok(prov.get(yId)!.endsWith(ProvenanceFixture.FileB));
});
