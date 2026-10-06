import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime';
import { check, checkAgainst } from '../../../../compiler-services/api.js';
import { toJSON } from '../../../../compiler-services/emit/json.js';
import { Severity } from '../../../../compiler-services/diagnostics/diagnostic.js';
import { SolutionGraph, type SolutionGraphMember } from '../solution-graph.js';

const META = { uri: 'mm/meta.todl', text: 'namespace ea { concept Location { label : string; } }' };
const LIB = { uri: 'lib/lib.todl', text: 'namespace lib { import ea; taxonomy MS : represents Location { term azure { } } }' };
const ARCH = { uri: 'arch/a.todl', text: 'namespace app { import lib; model M : ea { } }' };

class MemberFixture
{
    public static Make(id: string, srcs: { uri: string; text: string }[], baseIds: string[]): SolutionGraphMember
    {
        return { id, storage: new FakeStorage(), sources: srcs, baseIds, publishedBases: [] };
    }
}

describe('SolutionGraph.Build', () =>
{
    test('matches a from-scratch full compile (equivalence) and has no errors', async () =>
    {
        const g = new SolutionGraph();
        await g.Build([
            MemberFixture.Make('tech-architecture', [META], []),
            MemberFixture.Make('microsoft', [LIB], ['tech-architecture']),
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
        assert.ok(g.OriginOf.has('lib.MS'));
    });
});
