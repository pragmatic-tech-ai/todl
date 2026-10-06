import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { check, checkAgainst } from '../../api.js';
import { toJSON } from '../json.js';
import { ModelDraft } from '../../../authoring/model-draft.js';

const META = { uri: 'mm/meta.todl', text: 'namespace ea { concept Location { label : string; } concept App { loc : Location; } }' };
const LIB = { uri: 'lib/lib.todl', text: 'namespace lib { import ea; taxonomy MS : represents Location { term azure { } } }' };
const MODEL = 'namespace app { import ea; import lib; model m : ea uses MS { App a { loc = azure; } } }';

describe('.todl round-trip under qualified ids', () =>
{
    test('emit then re-load reproduces the qualified graph', () =>
    {
        const metaRepo = check([META]).model;
        const libRepo = checkAgainst([toJSON(metaRepo)], [LIB]).model;
        const bases = [metaRepo, libRepo];
        assert.ok(libRepo.has('lib.MS.azure'));

        const draft = ModelDraft.fromSource(bases, MODEL, { namespace: 'app' });
        const text = draft.toTodl();
        const again = ModelDraft.fromSource(bases, text, { namespace: 'app' });

        assert.ok(again.has('app.a'));
        assert.deepEqual(again.model.danglingRefs(), []);
        assert.ok(again.model.outEdges('app.a').some(e => e.to === 'lib.MS.azure'));
        assert.match(text, /uses lib\.MS\b/);
    });

    test('same-namespace reference is written namespace-stripped and re-resolves qualified', () =>
    {
        const metaRepo = check([META]).model;
        const libRepo = checkAgainst([toJSON(metaRepo)], [LIB]).model;
        const bases = [metaRepo, libRepo];

        const draft = ModelDraft.fromSource(bases, 'namespace lib { import ea; model m : ea uses MS { App a { loc = MS.azure; } } }', { namespace: 'lib' });
        const text = draft.toTodl();
        assert.match(text, /loc = MS\.azure;/);
        assert.doesNotMatch(text, /lib\.MS\.azure/);

        const again = ModelDraft.fromSource(bases, text, { namespace: 'lib' });
        assert.deepEqual(again.model.danglingRefs(), []);
        assert.ok(again.model.outEdges('lib.a').some(e => e.to === 'lib.MS.azure'));
    });

    test('an inline object keeps a BARE localId and round-trips without double-qualifying', () =>
    {
        const BOX = { uri: 'mm/box.todl', text: 'namespace ea { concept Box { child : Widget?; } concept Widget { name : string?; } }' };
        const bases = [check([BOX]).model];
        const src = 'namespace app { import ea; model m : ea { Box b { child = Widget { id = widget; name = "W"; }; } } }';

        const draft = ModelDraft.fromSource(bases, src, { namespace: 'app' });
        assert.ok(draft.has('app.widget'), 'inline node is namespace-qualified');
        assert.equal(draft.model.resolve('app.widget')?.localId, 'widget', 'localId is the BARE written id');

        // Emit then re-load: the inline child is re-emitted as `id = <localId>`, so a
        // qualified localId would re-qualify to `app.app.widget` and grow each cycle.
        const text = draft.toTodl();
        const again = ModelDraft.fromSource(bases, text, { namespace: 'app' });
        assert.ok(again.has('app.widget'), 'still app.widget after round-trip');
        assert.ok(!again.has('app.app.widget'), 'no double-qualification');
        assert.equal(again.model.resolve('app.widget')?.localId, 'widget', 'localId stays bare across round-trip');
    });
});
