import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ImportClosureWalker } from "./support/ImportClosureWalker.js";

interface IExportConditions
{
    import?: { development?: string };
}

interface IPackageManifest
{
    exports?: Record<string, IExportConditions>;
    bin?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

// Mural is a peer of todl: a regular dependency nests a second Mural copy in every consumer, and a devDependency
// beside the peer would let a consumer's `npm prune --omit=dev` strip todl's own installed copy (the package root
// barrel loads mural at module load, so the peer is required, not optional).
class PackageManifest
{
    private static readonly ManifestPath = "../../package.json";
    private static readonly MuralPackage = "@pragmatic-tech-ai/mural";
    private static readonly Encoding = "utf8";

    public static Path(): string
    {
        return fileURLToPath(new URL(PackageManifest.ManifestPath, import.meta.url));
    }

    public static Read(): IPackageManifest
    {
        return JSON.parse(readFileSync(PackageManifest.Path(), PackageManifest.Encoding)) as IPackageManifest;
    }

    public static get Mural(): string
    {
        return PackageManifest.MuralPackage;
    }
}

// Packages a consumer supplies itself, by entry point. GitHub Packages drops `peerDependenciesMeta` from its version
// metadata, so an optional peer arrives as a required one in every consumer's lockfile; a package only one subpath
// needs is therefore not a peer at all. `./engine` hosts add the graph engine to their own dependencies (README,
// "Graph engine"); todl keeps it as a devDependency for its own tests and build.
class ConsumerSuppliedPackages
{
    private static readonly PragmaticGraph = "@pragmatic-tech-ai/pragmatic-graph";
    private static readonly EngineEntry = "./engine";
    private static readonly ByEntry: ReadonlyMap<string, readonly string[]> = new Map([
        [ConsumerSuppliedPackages.EngineEntry, [ConsumerSuppliedPackages.PragmaticGraph]],
    ]);

    public static get Graph(): string
    {
        return ConsumerSuppliedPackages.PragmaticGraph;
    }

    public static All(): string[]
    {
        return [...ConsumerSuppliedPackages.ByEntry.values()].flat();
    }

    public static Includes(name: string): boolean
    {
        return ConsumerSuppliedPackages.All().includes(name);
    }
}

// Every bare package the shipped code imports, reached from the package's own entry points (each export subpath and
// each bin), must be a `dependencies` or `peerDependencies` entry: a devDependency is absent from a consumer's
// production install (`npm ci --omit=dev`), so a module that loads it fails at import. The one exception is the
// documented `ConsumerSuppliedPackages` list, which the consumer of that entry declares itself.
class RuntimeImportAudit
{
    private static readonly NodeScheme = "node:";
    private static readonly ScopePrefix = "@";
    private static readonly PathSeparator = "/";
    private static readonly DistDir = "dist/";
    private static readonly SrcDir = "src/";
    private static readonly JsExtension = /\.js$/;
    private static readonly TsExtension = ".ts";

    private readonly root: string;
    private readonly manifest: IPackageManifest;
    private readonly undeclared = new Set<string>();

    public constructor(manifest: IPackageManifest)
    {
        this.manifest = manifest;
        this.root = dirname(PackageManifest.Path());
    }

    public Undeclared(): string[]
    {
        const walker = new ImportClosureWalker((specifier, resolved) => this.Check(specifier, resolved));
        for (const entry of this.EntryFiles())
        {
            walker.Walk(entry);
        }
        return [...this.undeclared].sort();
    }

    public EntryFiles(): string[]
    {
        const entries: string[] = [];
        for (const conditions of Object.values(this.manifest.exports ?? {}))
        {
            const development = conditions.import?.development;
            if (development !== undefined)
            {
                entries.push(join(this.root, development));
            }
        }
        for (const bin of Object.values(this.manifest.bin ?? {}))
        {
            const source = bin.replace(RuntimeImportAudit.DistDir, RuntimeImportAudit.SrcDir).replace(RuntimeImportAudit.JsExtension, RuntimeImportAudit.TsExtension);
            entries.push(join(this.root, source));
        }
        return entries;
    }

    private Check(specifier: string, resolved: string | undefined): boolean
    {
        if (ImportClosureWalker.IsRelative(specifier) || resolved !== undefined || RuntimeImportAudit.IsBuiltin(specifier))
        {
            return false;
        }
        const name = RuntimeImportAudit.PackageName(specifier);
        const declared = this.manifest.dependencies?.[name] !== undefined
            || this.manifest.peerDependencies?.[name] !== undefined
            || ConsumerSuppliedPackages.Includes(name);
        if (!declared)
        {
            this.undeclared.add(name);
        }
        return !declared;
    }

    private static IsBuiltin(specifier: string): boolean
    {
        return specifier.startsWith(RuntimeImportAudit.NodeScheme) || builtinModules.includes(specifier);
    }

    private static PackageName(specifier: string): string
    {
        const segments = specifier.split(RuntimeImportAudit.PathSeparator);
        const length = specifier.startsWith(RuntimeImportAudit.ScopePrefix) ? 2 : 1;
        return segments.slice(0, length).join(RuntimeImportAudit.PathSeparator);
    }
}

describe("package manifest", () =>
{
    const manifest = PackageManifest.Read();

    it("declares mural as a peer dependency", () =>
    {
        assert.ok(manifest.peerDependencies?.[PackageManifest.Mural]);
    });

    it("does not declare mural as a regular or dev dependency", () =>
    {
        assert.equal(manifest.dependencies?.[PackageManifest.Mural], undefined);
        assert.equal(manifest.devDependencies?.[PackageManifest.Mural], undefined);
    });

    it("keeps the mural peer required", () =>
    {
        assert.notEqual(manifest.peerDependenciesMeta?.[PackageManifest.Mural]?.optional, true);
    });

    // GitHub Packages strips `peerDependenciesMeta` from registry metadata, so `optional` never reaches a consumer:
    // every peer todl declares must be one the consumer truly needs.
    it("declares no optional peers", () =>
    {
        const optional = Object.entries(manifest.peerDependenciesMeta ?? {}).filter(([, meta]) => meta.optional === true).map(([name]) => name);
        assert.deepEqual(optional, []);
    });

    it("leaves consumer-supplied packages out of dependencies and peers, keeping them as devDependencies", () =>
    {
        for (const name of ConsumerSuppliedPackages.All())
        {
            assert.equal(manifest.dependencies?.[name], undefined);
            assert.equal(manifest.peerDependencies?.[name], undefined);
            assert.equal(manifest.peerDependenciesMeta?.[name], undefined);
            assert.ok(manifest.devDependencies?.[name]);
        }
        assert.ok(ConsumerSuppliedPackages.Includes(ConsumerSuppliedPackages.Graph));
    });

    it("declares every package the shipped entry points import at runtime", () =>
    {
        const audit = new RuntimeImportAudit(manifest);
        assert.ok(audit.EntryFiles().length > 0);
        assert.deepEqual(audit.Undeclared(), []);
    });
});
