import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { check } from '../../api.js';

describe('Element root is qualified', () =>
{
    test('supertypesOf appends todl.Element', () =>
    {
        const r = check([{ uri: 's.todl', text: 'namespace ea { concept Location { } }' }]);
        assert.ok(r.model.supertypesOf('ea.Location').includes('todl.Element'));
        assert.ok(!r.model.supertypesOf('ea.Location').includes('Element'));
    });
});
