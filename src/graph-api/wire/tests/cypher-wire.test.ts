import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ImportClosureWalker } from '../../../tests/support/ImportClosureWalker.js';

/** The wire module must reach neither the engine nor any file under a `cypher` directory or named cypher. */
class WireForbidden
{
    private static readonly CypherSegments = new Set(['cypher', 'cypher.ts']);

    public static Is(specifier: string, resolved: string | undefined): boolean
    {
        return ImportClosureWalker.IsEngine(specifier) || (resolved !== undefined && path.relative(WireTestPaths.SrcRoot, resolved).split(path.sep).some(segment => WireForbidden.CypherSegments.has(segment)));
    }
}

class WireTestPaths
{
    public static readonly SrcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
    public static readonly GraphApi = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    public static readonly WireIndex = path.join(WireTestPaths.GraphApi, 'wire', 'index.ts');
    public static readonly Assembler = path.join(WireTestPaths.GraphApi, 'browser', 'tenant-document-assembler.ts');
}

test('wire module is engine- and cypher-free', () =>
{
    const result = new ImportClosureWalker(WireForbidden.Is).Walk(WireTestPaths.WireIndex);
    assert.ok(result.Files >= 3);
    assert.deepEqual(result.Offenders, []);
    assert.deepEqual(result.Unresolved, []);
});

test('assembler is cypher-free', () =>
{
    const result = new ImportClosureWalker(WireForbidden.Is).Walk(WireTestPaths.Assembler);
    assert.ok(result.Files >= 2);
    assert.deepEqual(result.Offenders, []);
    assert.deepEqual(result.Unresolved, []);
});
