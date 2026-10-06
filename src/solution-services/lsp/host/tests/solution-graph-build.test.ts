import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime';
import { check, checkAgainst } from '../../../../compiler-services/api.js';
import { toJSON } from '../../../../compiler-services/emit/json.js';
import { Severity } from '../../../../compiler-services/diagnostics/diagnostic.js';
import type { TodlDocument } from '../../../../compiler-services/emit/json.js';
import { WikiOriginKind } from '../../../project-services/core/wiki-origin.js';
import { SolutionGraph, type SolutionGraphMember } from '../solution-graph.js';

const META = { uri: 'mm/meta.todl', text: 'namespace ea { concept Location { label : string; } }' };
const LIB = { uri: 'lib/lib.todl', text: 'namespace lib { import ea; taxonomy MS : represents Location { term azure { } } }' };
const ARCH = { uri: 'arch/a.todl', text: 'namespace app { import lib; model M : ea { } }' };

const ARCH_EA = { uri: 'arch/b.todl', text: 'namespace app { import ea; model M : ea { } }' };

class MemberFixture
{
    public static Make(
        id: string, srcs: { uri: string; text: string }[], baseIds: string[],
        storage: FakeStorage = new FakeStorage(), publishedBases: TodlDocument[] = [],
    ): SolutionGraphMember
    {
        return { id, storage, sources: srcs, baseIds, publishedBases };
    }
}

describe('SolutionGraph.Build', () =>
{
    test('matches a from-scratch full compile (equivalence) and has no errors', async () =>
    {
        const g = new SolutionGraph();
        const msStorage = new FakeStorage();
        await g.Build([
            MemberFixture.Make('tech-architecture', [META], []),
            MemberFixture.Make('microsoft', [LIB], ['tech-architecture'], msStorage),
            MemberFixture.Make('arch', [ARCH], ['microsoft']),
        ]);

        // Full compile of the same source set, bases layered the same way.
        const metaDoc = toJSON(check([META]).model);
        const libDoc = toJSON(checkAgainst([metaDoc], [LIB]).model);
        const full = checkAgainst([metaDoc, libDoc], [ARCH]);

        assert.equal(g.DiagnosticsByUri().get('arch/a.todl')?.filter(d => d.severity === Severity.Error).length ?? 0, 0);
        for (const [uri, diags] of g.DiagnosticsByUri())
        {
            assert.equal(diags.filter(d => d.severity === Severity.Error).length, 0, `errors in ${uri}`);
        }
        // Equivalence: every node the full arch compile has, the shared graph resolves.
        for (const n of full.model.allNodes())
        {
            assert.ok(g.Model.has(n.id), `shared graph missing ${n.id}`);
        }
        // originOf tags the library's own node to its source member storage.
        const origin = g.OriginOf.get('lib.MS');
        assert.ok(origin);
        assert.equal(origin.kind, WikiOriginKind.OpenProject);
        assert.equal(origin.kind === WikiOriginKind.OpenProject ? origin.storage : undefined, msStorage);
    });

    test('rejects a dependency cycle', async () =>
    {
        const g = new SolutionGraph();
        await assert.rejects(
            g.Build([
                MemberFixture.Make('a', [META], ['b']),
                MemberFixture.Make('b', [LIB], ['a']),
            ]),
            /dependency cycle: a -> b -> a/);
    });

    test('rejects a duplicate member id', async () =>
    {
        const g = new SolutionGraph();
        await assert.rejects(
            g.Build([
                MemberFixture.Make('dup', [META], []),
                MemberFixture.Make('dup', [LIB], []),
            ]),
            /Duplicate solution member id: dup/);
    });

    test('seeds the graph from non-empty publishedBases', async () =>
    {
        const metaDoc = toJSON(check([META]).model);
        const g = new SolutionGraph();
        await g.Build([
            MemberFixture.Make('base', [], [], new FakeStorage(), [metaDoc]),
            MemberFixture.Make('arch', [ARCH_EA], ['base']),
        ]);
        assert.ok(g.Model.has('ea.Location'));
        assert.ok(g.Model.has('app.M'));
        for (const [uri, diags] of g.DiagnosticsByUri())
        {
            assert.equal(diags.filter(d => d.severity === Severity.Error).length, 0, `errors in ${uri}`);
        }
    });

    test('a failed Build (duplicate id) leaves the previously built graph intact', async () =>
    {
        const g = new SolutionGraph();
        await g.Build([
            MemberFixture.Make('tech-architecture', [META], []),
            MemberFixture.Make('microsoft', [LIB], ['tech-architecture']),
            MemberFixture.Make('arch', [ARCH], ['microsoft']),
        ]);
        const modelBefore = g.Model;
        const countBefore = g.Model.allNodes().length;
        assert.ok(g.Model.has('app.M'));

        await assert.rejects(
            g.Build([
                MemberFixture.Make('dup', [META], []),
                MemberFixture.Make('dup', [LIB], []),
            ]),
            /Duplicate solution member id: dup/);

        // The failed build is swapped in only on success, so the prior graph is untouched.
        assert.equal(g.Model, modelBefore, 'Model instance unchanged after a failed build');
        assert.ok(g.Model.has('app.M'), 'prior node still present');
        assert.equal(g.Model.allNodes().length, countBefore, 'node set unchanged');
    });
});
