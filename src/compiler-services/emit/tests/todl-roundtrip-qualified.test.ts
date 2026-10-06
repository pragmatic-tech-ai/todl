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
});
