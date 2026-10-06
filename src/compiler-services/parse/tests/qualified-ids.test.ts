import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { check, checkAgainst } from '../../api.js';
import { toJSON } from '../../emit/json.js';

const META = { uri: 'mm/meta.todl', text: 'namespace ea { concept Location { label : string; } }' };

describe('qualified ids', () =>
{
    test('a standalone compile qualifies declarations and prelude', () =>
    {
        const r = check([META]);
        assert.deepEqual(r.diagnostics.filter(d => d.severity === 'error'), []);
        assert.ok(r.model.has('ea.Location'), 'concept qualified');
        assert.ok(r.model.has('todl.icon'), 'prelude node qualified');
        assert.ok(!r.model.has('Location'), 'no bare id remains');
    });

    test('a taxonomy term is namespace+taxonomy qualified', () =>
    {
        const LIB = { uri: 'lib/lib.todl', text: 'namespace lib { import ea; taxonomy MS : represents Location { term azure { } } }' };
        const metaDoc = toJSON(check([META]).model);
        const r = checkAgainst([metaDoc], [LIB]);
        assert.ok(r.model.has('lib.MS'), 'taxonomy qualified');
        assert.ok(r.model.has('lib.MS.azure'), 'term namespace+taxonomy qualified');
    });

    test('two namespaces may reuse a local name in one Repository (collision gone)', () =>
    {
        const A = { uri: 'a/a.todl', text: 'namespace a { import ea; concept Thing : Location { } }' };
        const B = { uri: 'b/b.todl', text: 'namespace b { import ea; concept Thing : Location { } }' };
        const metaDoc = toJSON(check([META]).model);
        const r = checkAgainst([metaDoc], [A, B]);   // MUST NOT throw "node \"Thing\" already exists"
        assert.ok(r.model.has('a.Thing') && r.model.has('b.Thing'));
    });

    test('a bare reference resolves to the imported namespace, not the referrer', () =>
    {
        const A = { uri: 'a/a.todl', text: 'namespace a { import ea; concept Thing : Location { } }' };
        const metaDoc = toJSON(check([META]).model);
        const r = checkAgainst([metaDoc], [A]);
        // Thing extends Location, which lives in ea -> the Extends edge targets ea.Location
        const ext = r.model.outEdges('a.Thing').find(e => e.to.startsWith('ea.'));
        assert.ok(ext && ext.to === 'ea.Location', 'extends resolves to ea.Location');
    });

    test('an explicit qualifier wins over a same-named home node', () =>
    {
        // home ns `a` declares its own Location AND references ea.Location explicitly
        const A = { uri: 'a/a.todl', text: 'namespace a { import ea; concept Location { } concept Thing : ea.Location { } }' };
        const metaDoc = toJSON(check([META]).model);
        const r = checkAgainst([metaDoc], [A]);
        const ext = r.model.outEdges('a.Thing').find(e => e.to === 'ea.Location');
        assert.ok(ext, 'ea.Location qualifier resolved explicitly, not a.Location');
        assert.ok(r.model.has('a.Location') && r.model.has('ea.Location'));
    });

    test('composite and raw-name value refs round-trip qualified', () =>
    {
        // a term whose value member is a reference to another term (raw Name today) must qualify;
        // a composite value made of term refs qualifies each part; a plain string literal is left alone.
        const LIB = { uri: 'lib/lib.todl', text: 'namespace lib { import ea; taxonomy MS : represents Location { term cloud { } term azure { label = "Azure"; } } }' };
        const metaDoc = toJSON(check([META]).model);
        const r = checkAgainst([metaDoc], [LIB]);
        assert.equal(r.model.attr('lib.MS.azure', 'label'), 'Azure', 'string literal untouched');
    });

    test('bare prelude references resolve', () =>
    {
        const metaDoc = toJSON(check([META]).model);

        // A bare prelude primitive used as a field type resolves to `todl.identifier`.
        const FIELD = { uri: 'v/v.todl', text: 'namespace v { import ea; concept Thing { ref : identifier; } }' };
        const rf = checkAgainst([metaDoc], [FIELD]);
        assert.deepEqual(rf.diagnostics.filter(d => d.severity === 'error'), []);
        const ref = rf.model.effectiveSchema('v.Thing').fields.find(f => f.name === 'ref');
        assert.equal(ref?.type, 'todl.identifier', 'bare prelude primitive qualifies to todl.identifier');

        // A bare prelude annotation applied to a concept mints `<target>@todl.label`.
        const ANN = { uri: 'u/u.todl', text: 'namespace u { import ea; concept Loc : Location { annotate label { text = "x"; } } }' };
        const ra = checkAgainst([metaDoc], [ANN]);
        assert.ok(ra.model.has('u.Loc@todl.label'), 'bare prelude annotation application exists');

        // Control: a same-named LOCAL annotation still wins over the prelude fallback.
        const LOCAL = { uri: 'c/c.todl', text: 'namespace c { annotation Mark { } concept Loc { annotate Mark { } } }' };
        const rc = check([LOCAL]);
        assert.ok(rc.model.has('c.Loc@c.Mark'), 'local annotation resolves to the home namespace');
    });
});
