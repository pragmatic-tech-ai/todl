# PackageCompiler — Design

**Status**: Design — approved API shape, pending spec review
**Date**: 2026-09-06
**Module**: `src/package-manager/`

## 1. Context & Goal

Compiling a TODL project into a publishable npm package is today spread across
free functions in three layers:

- `compilePackage(bases, sources, identity, deps)` (`src/publish/publish.ts`) —
  pure: `checkAgainst` → gate on `Severity.Error` → own-only `model.json`
  (`toJSONOwn`) + `fullDocument` + derived `classes`. No I/O.
- `packProject(input, sink, options)` (`src/package-manager/pack.ts`) — calls
  `compilePackage`, then writes the npm layout (`package.json`, `model.json`,
  `src/`, `index.js`, `index.d.ts`) through a `PackageSink`.
- `packCommand` / `resolveBases` (`src/package-manager/commands.ts`) —
  orchestrate: read `project.plexus` + sources → resolve installed deps into
  bases → `packProject` → `FileSink`.

We want a single class, **`PackageCompiler`**, that owns the full pipeline
end-to-end — read → resolve → compile → emit — behind one entry point. This
consolidates the scattered free functions into one OOP unit (matching the
workspace's object-oriented convention) while leaving the pure primitives
(`compilePackage`, `toPackageJson`, `deriveClasses`) untouched so existing core
`publish/` consumers (e.g. the Plexus project factories) are unaffected.

A second, smaller goal: today's dependency resolution is **node_modules-only**
(`resolveBases` reads the installed tree). The compiler's default resolver adds
**registry fetch** — a declared dependency that isn't installed is fetched from
the registry and resolved transitively — so a project can be compiled without a
prior full `npm install` of every TODL dependency.

## 2. Locked Decisions

| Fork | Decision |
| --- | --- |
| Scope | **Full pipeline**: read project dir → resolve deps → compile → emit the npm layout. |
| I/O | **Injected seams with node/registry defaults** — the class is unit-testable in-memory (no disk, no network). |
| Dependency resolution | **node_modules first, then registry fetch** for anything not installed (transitive). |
| Publishing | **Out of scope.** The class compiles to artifacts; pushing to the registry stays `NpmRegistry.publishDir` / `publishCommand`, composed on top. It **reads** from the registry (to fetch deps) but never **writes** to it. |

## 3. Architecture

`PackageCompiler` is the one class callers use. It depends on three small
interfaces (seams), each with a default implementation, so the class orchestrates
and stays testable while the I/O- and network-heavy work is injected:

```
                 ┌───────────────────── PackageCompiler ─────────────────────┐
   compile(dir)  │  reader.read(dir)  →  toPackageJson  →  resolver.resolve   │
      ────────►  │        │                                     │             │
                 │        └── manifest + sources                └── bases     │
                 │                    ↓                                       │
                 │        compilePackage(bases, sources, identity, deps)      │  (pure core primitive)
                 │                    ↓ ok?                                    │
                 │        createSink(outDir).writeText(... 5 artifacts ...)   │
                 └────────────────────────────────────────────────────────────┘
                     reader: ProjectReader   resolver: BaseResolver   createSink: SinkFactory
```

### 3.1 Seams

```ts
/** Reads a project directory into its manifest + .todl sources.
 *  Default: NodeProjectReader (today's `readProject`, node:fs). */
interface ProjectReader {
  read(directory: string): Project; // Project = { directory, manifest, sources }
}

/** Resolves a manifest's declared dependencies (transitively) into ordered base
 *  documents — node_modules first, then the registry for anything not installed.
 *  Default: RegistryBaseResolver. */
interface BaseResolver {
  resolve(directory: string, manifest: ProjectManifest, scope: string): Promise<readonly TodlDocument[]>;
}

/** Makes the output sink for a directory. Default: (dir) => new FileSink(dir). */
type SinkFactory = (outDir: string) => PackageSink;
```

`Project`, `ProjectManifest`, `TodlDocument`, `PackageSink`, `FileSink` are
existing types — reused, not redefined.

### 3.2 The class

```ts
export interface CompileOptions {
  /** npm scope override. Default: DEFAULT_SCOPE (`@pragmatic-tech-ai`). */
  scope?: string;
  /** Output directory for the packed package. Default: `<directory>/dist`. */
  outDir?: string;
}

export interface CompileResult {
  ok: boolean;
  diagnostics: readonly Diagnostic[];
  errors: readonly Diagnostic[];      // diagnostics filtered to Severity.Error
  files?: string[];                   // package-relative paths written — iff ok
  package?: CompiledPackage;          // the in-memory compiled package — iff ok
}

export interface PackageCompilerDeps {
  reader?: ProjectReader;    // default: NodeProjectReader
  resolver?: BaseResolver;   // default: RegistryBaseResolver
  createSink?: SinkFactory;  // default: (dir) => new FileSink(dir)
}

export class PackageCompiler {
  constructor(deps?: PackageCompilerDeps);

  /** Read → resolve deps → compile → emit the npm layout. Writes nothing on a
   *  failing compile. Throws for an architecture manifest (not publishable) and
   *  for a declared dependency resolvable from neither node_modules nor the
   *  registry. */
  compile(directory: string, options?: CompileOptions): Promise<CompileResult>;
}
```

One public method. Everything else is private: deriving the `PackageIdentity`
and dependency `PackageRef`s from the manifest, and emitting the five artifacts
(`package.json`, `model.json`, `src/<uri>`, `index.js`, `index.d.ts`) — the
current `packProject` body, moved in as private methods.

### 3.3 Default `RegistryBaseResolver`

The registry-fetch resolver, injected by default. It combines the installed
tree with registry fetches and orders the closure:

1. Read installed TODL packages from `<directory>/node_modules`
   (`readInstalledPackages`) into an `InstalledPackage[]`, keyed by npm name.
2. Compute the manifest's declared dependency names (`dependencyNames`).
3. BFS the dependency graph: for each name not already collected, use the
   installed entry if present; otherwise fetch its tarball from the registry
   (`NpmRegistry.getContent`) and read it (`TarReader.readPackage`). A name that
   resolves to neither (not installed, not a TODL package on the registry) →
   throw naming it. Enqueue the resolved package's own `dependencies`.
4. `resolveClosure(collected, declaredNames)` → deps-first `metaModels` +
   `libraries`; return `[...metaModels, ...libraries]`.

Because registry config (URL, scope, token) is per-project (`.npmrc` under the
directory), the resolver builds its `NpmRegistry` **per call** via
`resolveRegistryConfig(directory, { scope }, process.env)`. For tests and for an
explicitly offline build, the constructor accepts an optional registry factory
`(directory: string, scope: string) => NpmRegistry | undefined`; returning
`undefined` means offline, so an uninstalled dependency throws rather than
fetching. The default factory builds the configured client. This resolver is the
one genuinely new piece of logic; the BFS mirrors the SP2 app bridge's
`resolveClosure` path but on the core/CLI side.

## 4. Data Flow & Error Handling

`compile(directory, options)`:

1. `project = reader.read(directory)`.
2. `packageJson = toPackageJson(project.manifest, { scope })` — **throws** for an
   architecture manifest (kept: an architecture is built by the app build system,
   not published).
3. `bases = await resolver.resolve(directory, project.manifest, scope)` — may
   **throw** (unresolvable dependency) or reject (registry/transport failure).
4. `identity = { id: packageJson.todl.id, version: packageJson.version, name: project.manifest.name }`;
   `deps = dependencyRefs(project.manifest)`.
5. `outcome = compilePackage(bases, project.sources, identity, deps)` — pure.
6. If `!outcome.ok` → return `{ ok: false, diagnostics, errors }`. **No sink is
   created; nothing is written.**
7. Else → `sink = createSink(outDir)`; write the five artifacts; return
   `{ ok: true, diagnostics, errors, files, package: outcome.package }`.

Errors are surfaced two ways, matching today's behavior: compile diagnostics
come back **in** the result (`ok: false` + `errors`), while structural
impossibilities (architecture manifest, unresolvable dependency) **throw**.

## 5. What Changes

**Absorbed into `PackageCompiler` (free functions removed):**
- `packProject` (`pack.ts`) → the class's private emit + the `compilePackage`
  call. `pack.ts` is deleted (its `handleModule`/`handleTypes` move into the
  class as private methods).
- `resolveBases` (`commands.ts`) → the default `RegistryBaseResolver`.
- `packCommand` (`commands.ts`) → a thin `new PackageCompiler().compile(dir, opts)`;
  `publishCommand` calls the class then `NpmRegistry.publishDir`. The CLI
  (`cli.ts`) is repointed accordingly. `PackResult` → `CompileResult` (renamed;
  same shape plus the optional `package`).

**Kept unchanged (pure primitives):**
- `compilePackage`, `PackageIdentity`, `PackageRef`, `CompiledPackage`,
  `PackageDocument`, `CompileOutcome` (`src/publish/publish.ts`).
- `toPackageJson`, `DEFAULT_SCOPE` (`package-json.ts`); `deriveClasses`
  (`reflect.ts`); `resolveClosure`, `dependencyNames`, `readInstalledPackages`,
  `TarReader`, `NpmRegistry`, `resolveRegistryConfig` — all reused by the class /
  default resolver.

**New files:**
- `src/package-manager/package-compiler.ts` — `PackageCompiler` + the seam
  interfaces + `NodeProjectReader`.
- `src/package-manager/base-resolver.ts` — `RegistryBaseResolver` (the default
  `BaseResolver`).
- `index.ts` re-exports `PackageCompiler`, `CompileOptions`, `CompileResult`,
  the seam interfaces, and `RegistryBaseResolver`.

## 6. Testing

All `tsx --test` / `node:test`, in `src/package-manager/tests/`:

- **`PackageCompiler`** with injected fakes (no disk, no network): a
  `ProjectReader` returning a canned `Project`, a `BaseResolver` returning canned
  bases, and a `MemorySink`. Assert: clean project → `ok`, the five artifacts
  written with the expected package-relative paths + parseable `model.json`; a
  project with a compile error → `ok: false`, `errors` populated, **sink
  untouched** (zero writes); an architecture manifest → throws.
- **`RegistryBaseResolver`** over an in-memory `HttpTransport` fake (the existing
  `NpmRegistry` test pattern) + a temp `node_modules`: installed-only resolves
  offline; a missing dep is fetched from the registry and its transitive deps
  followed; an unresolvable dep throws naming it; deps come back deps-first.
- **Regression**: the CLI `pack`/`publish` paths still produce the identical
  layout (the existing `pack`/`commands` tests, retargeted to the class).

## 7. Out of Scope / Deferred

- Publishing from the class (stays `NpmRegistry.publishDir` / `publishCommand`).
- The richer typed-class (`typeof(Class)`) `index.d.ts` bridge — `handleTypes`
  keeps emitting the current minimal declarations.
- Caching/incremental compilation; parallel multi-project builds.
- Changing the persisted `model.json` shape or the own-only closure semantics —
  `compilePackage` is reused verbatim.
