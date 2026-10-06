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

describe('WrittenSymbolResolver precedence', () =>
{
    test('prelude fallback when neither home nor imports declare the name', () =>
    {
        const r = check([{ uri: 's.todl', text: 'namespace ea { concept Location { } }' }]);
        assert.equal(WrittenSymbolResolver.ResolveFor('icon', 'ea', [], r.model), 'todl.icon');
        assert.equal(WrittenSymbolResolver.ResolveFor('label', 'ea', ['ea'], r.model), 'todl.label');
    });
    test('home namespace shadows the prelude', () =>
    {
        const r = check([{ uri: 's.todl', text: 'namespace ea { concept icon { } }' }]);
        assert.equal(WrittenSymbolResolver.ResolveFor('icon', 'ea', [], r.model), 'ea.icon');
    });
    test('import shadows the prelude', () =>
    {
        const r = check([{ uri: 's.todl', text: 'namespace ea { concept icon { } }' }]);
        assert.equal(WrittenSymbolResolver.ResolveFor('icon', 'other', ['ea'], r.model), 'ea.icon');
    });
    test('home namespace wins over an import; first matching import wins', () =>
    {
        const r = check([
            { uri: 'a.todl', text: 'namespace ea { concept Thing { } }' },
            { uri: 'b.todl', text: 'namespace eb { concept Thing { } }' },
            { uri: 'c.todl', text: 'namespace ec { concept Thing { } }' },
        ]);
        assert.equal(WrittenSymbolResolver.ResolveFor('Thing', 'ec', ['ea', 'eb'], r.model), 'ec.Thing');
        assert.equal(WrittenSymbolResolver.ResolveFor('Thing', 'other', ['eb', 'ea'], r.model), 'eb.Thing');
        assert.equal(WrittenSymbolResolver.ResolveFor('Thing', 'other', ['ea', 'eb'], r.model), 'ea.Thing');
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
