import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { check } from '../../../../compiler-services/api.js';
import { WrittenSymbolResolver } from '../written-symbol-resolver.js';
import { AnalysisSnapshot } from '../analysis-snapshot.js';
import { NavigationProvider } from '../navigation-provider.js';

describe('WrittenSymbolResolver', () =>
{
    test('bare name resolves to the home-namespace qualified id', () =>
    {
        const r = check([{ uri: 's.todl', text: 'namespace ea { concept Location { } }' }]);
        assert.equal(WrittenSymbolResolver.ResolveFor('Location', 'ea', [], r.model), 'ea.Location');
    });
    test('written-qualified resolves to itself', () =>
    {
        const r = check([{ uri: 's.todl', text: 'namespace ea { concept Location { } }' }]);
        assert.equal(WrittenSymbolResolver.ResolveFor('ea.Location', 'other', ['ea'], r.model), 'ea.Location');
    });
    test('imported namespace and unknown names', () =>
    {
        const r = check([{ uri: 's.todl', text: 'namespace ea { concept Location { } }' }]);
        assert.equal(WrittenSymbolResolver.ResolveFor('Location', 'other', ['ea'], r.model), 'ea.Location');
        assert.equal(WrittenSymbolResolver.ResolveFor('Nope', 'ea', [], r.model), undefined);
    });
});

describe('bare-name navigation after qualification', () =>
{
    const text = 'namespace ea {\n  concept Location { }\n  concept Site : Location { }\n}\n';
    const snap = AnalysisSnapshot.Build([{ uri: 's.todl', text }]);
    const nav = new NavigationProvider();
    const usePos = { line: 2, character: text.split('\n')[2]!.indexOf('Location') + 1 };

    test('DefinitionAt on a bare reference lands on the declaration', () =>
    {
        const loc = nav.DefinitionAt(snap, 's.todl', usePos);
        assert.ok(loc !== null);
        assert.equal(loc.range.start.line, 1);
    });
    test('ReferencesAt finds the bare occurrence plus declaration', () =>
    {
        const locs = nav.ReferencesAt(snap, 's.todl', usePos, true);
        assert.equal(locs.length, 2);
    });
});
