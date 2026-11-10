import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Cypher, CypherWire } from '../../../index.js';

/** Statically walks the relative import closure of an entry file and collects forbidden specifiers. */
class WireImportWalker
{
    private static readonly SpecifierPattern = /(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    private static readonly Utf8 = 'utf8';
    private static readonly Engine = '@pragmatic-tech-ai/graph';
    private static readonly CypherSegment = '/cypher/';
    private static readonly Relative = '.';
    private static readonly JsExtension = /\.js$/;
    private static readonly TsExtension = '.ts';
    private static readonly IndexFile = 'index.ts';

    private readonly visited = new Set<string>();
    private readonly offenders: string[] = [];

    public static Offenders(entry: string): { Files: number; Offenders: string[] }
    {
        const walker = new WireImportWalker();
        walker.Visit(entry);
        return { Files: walker.visited.size, Offenders: walker.offenders };
    }

    private Visit(file: string): void
    {
        if (this.visited.has(file))
        {
            return;
        }
        this.visited.add(file);
        const source = fs.readFileSync(file, WireImportWalker.Utf8);
        for (const match of source.matchAll(WireImportWalker.SpecifierPattern))
        {
            const specifier = match[1] ?? match[2] ?? match[3] ?? '';
            const normalized = specifier.split(path.sep).join('/');
            if (normalized.startsWith(WireImportWalker.Engine) || normalized.includes(WireImportWalker.CypherSegment))
            {
                this.offenders.push(`${path.basename(file)} -> ${specifier}`);
            }
            if (specifier.startsWith(WireImportWalker.Relative))
            {
                const resolved = WireImportWalker.Resolve(file, specifier);
                assert.ok(resolved !== undefined, `unresolved ${specifier} in ${file}`);
                this.Visit(resolved);
            }
        }
    }

    private static Resolve(from: string, specifier: string): string | undefined
    {
        const base = path.resolve(path.dirname(from), specifier);
        const candidates = [
            base.replace(WireImportWalker.JsExtension, WireImportWalker.TsExtension),
            base,
            base + WireImportWalker.TsExtension,
            path.join(base, WireImportWalker.IndexFile),
        ];
        return candidates.find(c => fs.existsSync(c) && fs.statSync(c).isFile());
    }
}

class WireTestPaths
{
    public static readonly GraphApi = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    public static readonly WireIndex = path.join(WireTestPaths.GraphApi, 'wire', 'index.ts');
    public static readonly Assembler = path.join(WireTestPaths.GraphApi, 'browser', 'tenant-document-assembler.ts');
}

test('wire codec is the Cypher codec', () =>
{
    assert.equal(CypherWire.CypherCellCodec, Cypher.CypherCellCodec);
});

test('wire module is engine- and cypher-free', () =>
{
    const result = WireImportWalker.Offenders(WireTestPaths.WireIndex);
    assert.ok(result.Files >= 3);
    assert.deepEqual(result.Offenders, []);
});

test('assembler is cypher-free', () =>
{
    const result = WireImportWalker.Offenders(WireTestPaths.Assembler);
    assert.ok(result.Files >= 2);
    assert.deepEqual(result.Offenders, []);
});
