import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Walks the static import closure of the package root to prove the engine is not reachable from it. */
class ImportClosureWalker
{
    private static readonly EngineSpecifier = '@pragmatic-tech-ai/graph';
    private static readonly SpecifierPattern = /(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    private static readonly Utf8 = 'utf8';
    private static readonly RelativePrefix = '.';
    private static readonly JsExtension = /\.js$/;
    private static readonly TsExtension = '.ts';
    public static readonly IndexFile = 'index.ts';

    private readonly visited = new Set<string>();
    private readonly offenders: string[] = [];
    private readonly unresolved: string[] = [];

    public Walk(entry: string): { Files: number; Offenders: string[]; Unresolved: string[] }
    {
        this.Visit(entry);
        return { Files: this.visited.size, Offenders: this.offenders, Unresolved: this.unresolved };
    }

    private Visit(file: string): void
    {
        if (this.visited.has(file))
        {
            return;
        }
        this.visited.add(file);
        const source = fs.readFileSync(file, ImportClosureWalker.Utf8);
        for (const match of source.matchAll(ImportClosureWalker.SpecifierPattern))
        {
            const specifier = match[1] ?? match[2] ?? match[3] ?? match[4] ?? '';
            if (specifier === ImportClosureWalker.EngineSpecifier || specifier.startsWith(ImportClosureWalker.EngineSpecifier + '/'))
            {
                this.offenders.push(file);
            }
            else if (specifier.startsWith(ImportClosureWalker.RelativePrefix))
            {
                const resolved = this.Resolve(file, specifier);
                if (resolved === undefined)
                {
                    this.unresolved.push(`${file} -> ${specifier}`);
                }
                else
                {
                    this.Visit(resolved);
                }
            }
        }
    }

    /**
     * Every file under `srcRoot` outside `bridgeDir` (tests included) that imports the engine, or imports a module
     * of the bridge directly (whose closure may reach the engine).
     */
    public static BoundaryOffenders(srcRoot: string, bridgeDir: string): string[]
    {
        const walker = new ImportClosureWalker();
        const offenders: string[] = [];
        for (const file of ImportClosureWalker.TsFiles(srcRoot))
        {
            if (file.startsWith(bridgeDir + path.sep))
            {
                continue;
            }
            const source = fs.readFileSync(file, ImportClosureWalker.Utf8);
            for (const match of source.matchAll(ImportClosureWalker.SpecifierPattern))
            {
                const specifier = match[1] ?? match[2] ?? match[3] ?? match[4] ?? '';
                const engine = specifier === ImportClosureWalker.EngineSpecifier || specifier.startsWith(ImportClosureWalker.EngineSpecifier + '/');
                const resolved = specifier.startsWith(ImportClosureWalker.RelativePrefix) ? walker.Resolve(file, specifier) : undefined;
                if (engine || (resolved !== undefined && resolved.startsWith(bridgeDir + path.sep)))
                {
                    offenders.push(path.relative(srcRoot, file));
                }
            }
        }
        return offenders;
    }

    private static TsFiles(dir: string): string[]
    {
        const out: string[] = [];
        for (const entry of fs.readdirSync(dir, { withFileTypes: true }))
        {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory())
            {
                out.push(...ImportClosureWalker.TsFiles(full));
            }
            else if (entry.isFile() && entry.name.endsWith(ImportClosureWalker.TsExtension))
            {
                out.push(full);
            }
        }
        return out;
    }

    private Resolve(from: string, specifier: string): string | undefined
    {
        const base = path.resolve(path.dirname(from), specifier);
        const candidates = [
            base.replace(ImportClosureWalker.JsExtension, ImportClosureWalker.TsExtension),
            base,
            base + ImportClosureWalker.TsExtension,
            path.join(base, ImportClosureWalker.IndexFile),
        ];
        return candidates.find(c => fs.existsSync(c) && fs.statSync(c).isFile());
    }
}

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
