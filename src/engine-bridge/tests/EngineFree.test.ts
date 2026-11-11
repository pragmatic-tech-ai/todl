import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ImportClosureWalker } from '../../tests/support/ImportClosureWalker.js';

test('the package root import closure never reaches the graph engine', () =>
{
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', ImportClosureWalker.IndexFile);
    const result = new ImportClosureWalker().Walk(root);
    assert.ok(result.Files > 10, 'walker should traverse the package');
    assert.deepEqual(result.Offenders, []);
    assert.deepEqual(result.Unresolved, []);
});

test('no file outside src/engine-bridge, tests included, imports the engine or the bridge', () =>
{
    const bridge = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    assert.deepEqual(ImportClosureWalker.BoundaryOffenders(path.dirname(bridge), bridge), []);
});

test('the engine subpath resolves', async () =>
{
    const mod = await import('@pragmatic-tech-ai/todl/engine');
    assert.equal(typeof mod.EngineBridgeError, 'function');
    assert.equal(mod.EngineBridgeErrorCode.Stale, 4);
    const err = new mod.EngineBridgeError(mod.EngineBridgeErrorCode.ForeignId, 'x');
    assert.equal(err.Code, mod.EngineBridgeErrorCode.ForeignId);
    assert.ok(err instanceof Error);
});
