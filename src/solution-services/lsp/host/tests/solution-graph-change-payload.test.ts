import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime';
import { SolutionGraph, type SolutionGraphChange, type SolutionGraphMember } from '../solution-graph.js';

class PayloadFixture
{
    public static readonly FileA = { uri: 'm/a.todl', text: 'namespace na { concept A { label : string; } }' };
    public static readonly FileB = { uri: 'm/b.todl', text: 'namespace nb { concept B { label : string; } }' };
    public static readonly FileBEdited = { uri: 'm/b.todl', text: 'namespace nb { concept B { label : string; } concept C { } }' };
    public static readonly Other = { uri: 'o/o.todl', text: 'namespace no { concept O { label : string; } }' };

    public static Member(id: string, srcs: { uri: string; text: string }[]): SolutionGraphMember
    {
        return { id, storage: new FakeStorage(), sources: srcs, baseIds: [], publishedBases: [] };
    }
}

describe('SolutionGraphChange fileIds', () =>
{
    test('Build emits every loaded file URI alongside member ids', async () =>
    {
        const g = new SolutionGraph();
        const emits: SolutionGraphChange[] = [];
        g.Changed.subscribe(c => { emits.push(c); });
        await g.Build([
            PayloadFixture.Member('m', [PayloadFixture.FileA, PayloadFixture.FileB]),
            PayloadFixture.Member('o', [PayloadFixture.Other]),
        ]);
        assert.equal(emits.length, 1);
        assert.deepEqual([...emits[0]!.memberIds].sort(), ['m', 'o']);
        assert.deepEqual([...emits[0]!.fileIds].sort(), ['m/a.todl', 'm/b.todl', 'o/o.todl']);
    });

    test('ReplaceMember emits only the affected member files', async () =>
    {
        const g = new SolutionGraph();
        await g.Build([
            PayloadFixture.Member('m', [PayloadFixture.FileA, PayloadFixture.FileB]),
            PayloadFixture.Member('o', [PayloadFixture.Other]),
        ]);
        const emits: SolutionGraphChange[] = [];
        g.Changed.subscribe(c => { emits.push(c); });
        g.ReplaceMember('m', [PayloadFixture.FileA, PayloadFixture.FileBEdited]);
        assert.equal(emits.length, 1);
        assert.deepEqual([...emits[0]!.memberIds], ['m']);
        assert.deepEqual([...emits[0]!.fileIds].sort(), ['m/a.todl', 'm/b.todl']);
    });
});
