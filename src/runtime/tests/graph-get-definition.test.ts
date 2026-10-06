import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { check } from '../../compiler-services/api.js';
import { toJSON } from '../../compiler-services/emit/json.js';
import { TODL } from '../graph.js';

describe('runtime GetDefinition with qualified ids', () =>
{
    test('resolves a node by its qualified id', () =>
    {
        const doc = toJSON(check([{ uri: 's.todl', text: 'namespace ea { concept Location { } }' }]).model);
        const g = TODL.ComposeGraph([doc], []);
        assert.ok(g.GetDefinition('ea.Location'), 'qualified id resolves');
        assert.equal(g.GetDefinition('ea.NoSuch'), undefined);
    });
});
