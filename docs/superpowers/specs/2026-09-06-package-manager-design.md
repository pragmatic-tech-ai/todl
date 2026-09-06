# PackageManager Design

**Date:** 2026-09-06
**Status:** Approved
**Related:** [PackageCompiler design](2026-09-06-package-compiler-design.md), [TODL package manager design](2026-09-03-todl-package-manager-design.md), [Electron app package manager design](2026-09-04-todl-app-electron-package-manager-design.md)

## Problem

There is no `PackageManager` class. The registry-facing operations that
constitute "the package manager" live as six free functions in
`src/package-manager/commands.ts` (`packCommand`, `publishCommand`,
`installCommand`, `listCommand`, `versionsCommand`, `getCommand`), each
re-resolving a config and newing up an `NpmRegistry`. The Electron app's
`RegistryBridge` reimplements the same orchestration a second time —
including a hand-rolled registry-fetch closure BFS that duplicates logic
that belongs in one place. Free functions also violate the workspace OOP
rule.

## Goal

Introduce a single `PackageManager` class that owns the registry-facing
surface. Both consumers — the `todl` CLI and the app's `RegistryBridge` —
delegate to it. Delete `commands.ts`. Remove the duplicated closure BFS.

## Boundary

`PackageManager` is **registry-facing only**. Its surface is the registry,
compiled packages, and published packages. It never reads a project
directory and never invokes the compiler.

Anything that starts from a **project directory** belongs elsewhere:

- **`PackageCompiler`** (unchanged) — project directory → compiled package
  (`compile(directory, options)`). It keeps building its own registry
  inside `RegistryBaseResolver`; `PackageManager` does not hand it one.
  The two are siblings, not owner/owned.
- **`ProjectInstaller`** (new, tiny) — `install(directory)`, a thin wrapper
  over an injected `runNpm` runner.

The compile-then-publish flow is a thin composition in `cli.ts`, not a
method on either class: `compiler.compile(dir)` → on `ok`,
`manager.publish(distDir)`.

## API

```ts
// src/package-manager/package-manager.ts

/** One authored source file recovered from a published package tarball. */
export interface PackageSource {
  name: string;   // path under package/src/
  text: string;
}

export class PackageManager {
  private readonly registry: NpmRegistry;

  constructor(config: NpmRegistryConfig) {
    this.registry = new NpmRegistry(config);
  }

  // ── registry reads ──
  list(): Promise<string[]>;
  versions(name: string): Promise<VersionList>;
  /** The package's declared TODL kind, or "" if it carries no todl block. */
  manifestKind(name: string): Promise<string>;
  getContent(ref: PackageRef): Promise<Uint8Array>;
  /** A compiled package parsed from its tarball. Throws if not a TODL package. */
  getPackage(ref: PackageRef): Promise<InstalledPackage>;
  /** The authored src/** of a published package. */
  getSources(ref: PackageRef): Promise<PackageSource[]>;
  /** Registry-only BFS over published packages: fetch each root dep and its
   *  transitive TODL deps, then resolve the closure. Non-TODL deps are ignored. */
  resolveClosure(rootDeps: readonly string[]): Promise<ResolvedClosure>;

  // ── publish / fetch already-built packages ──
  /** Publish an ALREADY-compiled package directory (registry PUT). */
  publish(compiledDir: string): Promise<void>;
  /** Download a published tarball to `outFile`. */
  get(refInput: string, outFile: string): Promise<void>;

  private static parseRef(input: string): PackageRef;  // "name@version" split
}
```

### Construction

Config lives in the constructor. Each caller resolves its own config and
passes it — there is no factory sugar:

- **CLI**: `new PackageManager(resolveRegistryConfig(cwd, flags, process.env))`.
- **App**: `new PackageManager(configFromSettings)` — via the bridge's
  `createManager` factory (see below).

The constructor takes `NpmRegistryConfig` directly. Its transport seam
(`config.transport`) is the test seam.

## Consumers

### cli.ts (orchestrator)

`cli.ts` drives the three classes directly. `commands.ts` is deleted.

- `pack [dir]` → `new PackageCompiler().compile(dir, {scope?})`; print
  errors and exit 1 on `!ok`.
- `install [dir]` → `new ProjectInstaller().install(dir)`.
- `publish [dir]` → `compile(dir, {scope, outDir})`; on `!ok` print errors
  and exit 1 **without publishing**; else
  `new PackageManager(config).publish(outDir)`.
- `list` / `versions <name>` → `manager.list()` / `manager.versions(name)`.
- `get <ref> [--out f]` → `manager.get(ref, outFile)`.

### RegistryBridge (app)

The bridge stops hand-rolling registry ops and the closure BFS. It becomes
an app-config + IPC adapter that delegates package operations to an
injected manager.

- **Deps shrink** to:
  ```ts
  export interface RegistryBridgeDeps {
    tokenStore: TokenStore;
    settingsStore: SettingsStore;
    /** Build a manager from a resolved config (prod: (c) => new PackageManager(c)). */
    createManager(config: NpmRegistryConfig): PackageManagerLike;
    env: Record<string, string | undefined>;
  }
  ```
  `createRegistry`, `readPackage`, `resolveClosure`, and `readFiles` are
  removed.
- **Kept on the bridge** (genuinely app-side): config-from-settings,
  `getConfig`, `setStoredToken`, `useEnvToken`, `listEnvVars`,
  `setSettings`, and `effectiveToken`.
- Each `registry:*` method is a one-liner delegating to `this.manager()`,
  where `manager()` = `createManager(this.config())` (built per call, so a
  settings/token change takes effect immediately, as today).
- `PackageManagerLike` is a **structural, type-only** interface declared in
  the bridge, listing exactly the methods the bridge calls. This preserves
  the property that the bridge type-only-imports package-manager symbols,
  so the `tsx` test runner needs no bundler alias. Only `main/index.ts`
  (the one runtime importer) wires
  `createManager: (c) => new PackageManager(c)`.

`PackageSource` moves from the bridge into core (`package-manager`) and is
exported; the bridge type-imports it.

## Error semantics

Preserved from today's free functions and bridge:

- `getPackage` throws `"<name> is not a TODL package"` when the tarball has
  no readable package.
- `manifestKind` returns `""` when the version manifest has no `todl` block.
- `getContent` / `publish` propagate transport/HTTP failures.
- `resolveClosure` ignores non-TODL deps; a failed tarball fetch propagates.
- The `publish` composition in `cli.ts` exits non-zero on a failed compile
  and publishes nothing.

## Testing

- `tests/package-manager.test.ts` — every method against a fake
  `config.transport` (in-memory registry serving packuments + tarballs, the
  pattern `registry/tests/npm-registry.test.ts` already uses): `list`,
  `versions`, `manifestKind`, `getContent`, `getPackage` (incl. the
  not-a-TODL-package throw), `getSources`, `resolveClosure` (transitive),
  `publish` (asserts the PUT), `get` (asserts bytes written).
- `tests/project-installer.test.ts` — a fake runner asserts the installer
  invokes `["install"]` with the given cwd.
- `tests/commands.test.ts` — retargeted to a `PackageCompiler` on-disk
  integration test (real `node_modules`); renamed to reflect the compiler
  focus.
- `tests/resolve.test.ts` — already uses `PackageCompiler`; unchanged.
- App `registry-bridge` tests — rewritten to inject a fake
  `PackageManagerLike`; smaller than today's four-seam fakes. The
  token/env-var/settings tests are unaffected.

MuralBase-based renderer VMs are not touched; no e2e change is required
(the app's behavior is identical — only the bridge's internals move).

## Non-goals

- No change to `PackageCompiler`, `NpmRegistry`, `RegistryBaseResolver`, or
  the wire protocol.
- No change to IPC channel names or the preload/renderer surface.
- No new CLI commands; `todl <pack|install|publish|list|versions|get>` is
  unchanged in behavior.
```