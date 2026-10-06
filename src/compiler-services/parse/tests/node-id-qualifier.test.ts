import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { NodeIdQualifier } from '../node-id-qualifier.js';

describe('NodeIdQualifier', () =>
{
    test('qualifies a local name with its namespace', () =>
    {
        assert.equal(NodeIdQualifier.Qualify('acme', 'Widget'), 'acme.Widget');
    });
    test('leaves builtins unqualified', () =>
    {
        for (const b of ['string', 'number', 'integer', 'boolean'])
            assert.equal(NodeIdQualifier.Qualify('acme', b), b);
        assert.ok(NodeIdQualifier.IsBuiltin('string'));
        assert.ok(!NodeIdQualifier.IsBuiltin('Widget'));
    });
    test('leaves a null namespace unqualified', () =>
    {
        assert.equal(NodeIdQualifier.Qualify(null, 'Widget'), 'Widget');
    });
});
