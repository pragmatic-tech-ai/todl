import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime';
import { SolutionGraph, type SolutionGraphMember } from '../solution-graph.js';
import { ResourceLocator } from '../resource-locator.js';

const META = { uri: 'mm/meta.todl', text: 'namespace ea { concept Location { label : string; } }' };
const META_THUMB = { uri: 'mm/meta.todl', text: 'namespace ea { concept Location { label : string; } annotation thumbnail : MuralResource { path : string?; } }' };

class Fixture
{
    public static Member(
        id: string, srcs: { uri: string; text: string }[], baseIds: string[],
        storage: FakeStorage = new FakeStorage(),
    ): SolutionGraphMember
    {
        return { id, storage, sources: srcs, baseIds, publishedBases: [] };
    }

    public static Lib(termBody: string): { uri: string; text: string }
    {
        return {
            uri: 'lib/lib.todl',
            text: `namespace lib { import ea; taxonomy MS : represents Location { term azure { ${termBody} } } }`,
        };
    }
}

describe('ResourceLocator', () =>
{
    test('resolves an icon annotation path to the source member storage', async () =>
    {
        const msStorage = new FakeStorage();
        const g = new SolutionGraph();
        await g.Build([
            Fixture.Member('tech-architecture', [META], []),
            Fixture.Member('microsoft', [Fixture.Lib('annotate icon { path = "resources/azure.svg"; }')], ['tech-architecture'], msStorage),
        ]);
        const loc = new ResourceLocator(g.Model, g.OriginOf, new FakeStorage());
        const res = loc.Resources('lib.MS.azure');
        assert.equal(res.length, 1);
        assert.equal(res[0].path, 'resources/azure.svg');
        assert.ok(res[0].storage, 'resolved to the member source storage');
        assert.equal(res[0].storage, msStorage);
    });

    test('a resource annotation without a path is skipped (no throw)', async () =>
    {
        const g = new SolutionGraph();
        await g.Build([
            Fixture.Member('tech-architecture', [META], []),
            Fixture.Member('microsoft', [Fixture.Lib('annotate icon { }')], ['tech-architecture']),
        ]);
        const loc = new ResourceLocator(g.Model, g.OriginOf, new FakeStorage());
        assert.deepEqual(loc.Resources('lib.MS.azure'), []);
    });

    test('a new annotation extending MuralResource resolves the same way (generality)', async () =>
    {
        const g = new SolutionGraph();
        await g.Build([
            Fixture.Member('tech-architecture', [META_THUMB], []),
            Fixture.Member('microsoft', [Fixture.Lib('annotate thumbnail { path = "resources/t.png"; }')], ['tech-architecture']),
        ]);
        const loc = new ResourceLocator(g.Model, g.OriginOf, new FakeStorage());
        const res = loc.Resources('lib.MS.azure');
        assert.equal(res.length, 1);
        assert.equal(res[0].annotation, 'ea.thumbnail');
        assert.equal(res[0].path, 'resources/t.png');
        assert.deepEqual(g.Model.supertypesOf('ea.thumbnail').includes('todl.MuralResource'), true);
    });
});
