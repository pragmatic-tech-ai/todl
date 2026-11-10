import * as fs from 'node:fs';
import * as path from 'node:path';

/** A specifier seen in an import closure, with the file that declares it and the file it resolves to (relative imports only). */
export interface IImportEdge
{
    readonly From: string;
    readonly Specifier: string;
    readonly Resolved: string | undefined;
}

/** Walks the static import closure of an entry file; a specifier is an offender when the supplied predicate says so. */
export class ImportClosureWalker
{
    public static readonly EngineSpecifier = '@pragmatic-tech-ai/graph';
    public static readonly IndexFile = 'index.ts';
    private static readonly SpecifierPattern = /(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    private static readonly Utf8 = 'utf8';
    private static readonly CurrentDirPrefix = './';
    private static readonly ParentDirPrefix = '../';
    private static readonly JsExtension = /\.js$/;
    private static readonly TsExtension = '.ts';

    private readonly visited = new Set<string>();
    private readonly offenders: string[] = [];
    private readonly unresolved: string[] = [];

    /** `isOffender(specifier, resolved)`: `resolved` is the target file of a relative specifier, else undefined. */
    constructor(private readonly isOffender: (specifier: string, resolved: string | undefined) => boolean = ImportClosureWalker.IsEngine)
    {
    }

    public static IsEngine(specifier: string): boolean
    {
        return specifier === ImportClosureWalker.EngineSpecifier || specifier.startsWith(ImportClosureWalker.EngineSpecifier + '/');
    }

    public Walk(entry: string): { Files: number; Offenders: string[]; Unresolved: string[] }
    {
        this.Visit(entry);
        return { Files: this.visited.size, Offenders: this.offenders, Unresolved: this.unresolved };
    }

    /** Every import edge declared in `file` (relative ones resolved). */
    public static Edges(file: string): IImportEdge[]
    {
        const source = fs.readFileSync(file, ImportClosureWalker.Utf8);
        const edges: IImportEdge[] = [];
        for (const match of source.matchAll(ImportClosureWalker.SpecifierPattern))
        {
            const specifier = match[1] ?? match[2] ?? match[3] ?? match[4] ?? '';
            const resolved = ImportClosureWalker.IsRelative(specifier) ? ImportClosureWalker.Resolve(file, specifier) : undefined;
            edges.push({ From: file, Specifier: specifier, Resolved: resolved });
        }
        return edges;
    }

    public static IsRelative(specifier: string): boolean
    {
        return specifier.startsWith(ImportClosureWalker.CurrentDirPrefix) || specifier.startsWith(ImportClosureWalker.ParentDirPrefix);
    }

    private Visit(file: string): void
    {
        if (this.visited.has(file))
        {
            return;
        }
        this.visited.add(file);
        for (const edge of ImportClosureWalker.Edges(file))
        {
            if (this.isOffender(edge.Specifier, edge.Resolved))
            {
                this.offenders.push(file);
            }
            if (ImportClosureWalker.IsRelative(edge.Specifier))
            {
                if (edge.Resolved === undefined)
                {
                    this.unresolved.push(`${file} -> ${edge.Specifier}`);
                }
                else
                {
                    this.Visit(edge.Resolved);
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
        const offenders: string[] = [];
        for (const file of ImportClosureWalker.TsFiles(srcRoot))
        {
            if (file.startsWith(bridgeDir + path.sep))
            {
                continue;
            }
            for (const edge of ImportClosureWalker.Edges(file))
            {
                if (ImportClosureWalker.IsEngine(edge.Specifier) || (edge.Resolved !== undefined && edge.Resolved.startsWith(bridgeDir + path.sep)))
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

    public static Resolve(from: string, specifier: string): string | undefined
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
