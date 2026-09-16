/**
 * `RegistryBridge` — the logic behind the `registry:*` / `config:*` IPC channels
 * (design §5 + package-manager). It resolves the app's registry config from its
 * settings + effective token, then delegates every package operation to a
 * `PackageManager` built via the injected `createManager` factory. App-side
 * concerns (config, token source, env-var tokens) stay here. Package-manager
 * symbols are type-only imports, so the test runner needs no bundler alias;
 * only `main/index.ts` runtime-imports package-manager to supply createManager.
 */
import type { TokenStore } from "./token-store.js";
import type { SettingsStore, RegistrySettings } from "./settings-store.js";
import { TokenSource } from "./settings-store.js";
import { join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import type {
  NpmRegistryConfig,
  PackageRef,
  VersionList,
  InstalledPackage,
  ResolvedClosure,
  PackageSource,
  PackageContents,
  CompileResult,
  LocalPackageStore,
} from "@pragmatic-tech-ai/todl/package-manager";
import type { ResolvedPackage, PackageRef as DomainPackageRef } from "@pragmatic-tech-ai/todl/domain";

/** The subset of `PackageManager` the bridge uses (structurally satisfied by it). */
export interface PackageManagerLike {
  list(): Promise<string[]>;
  versions(name: string): Promise<VersionList>;
  manifestKind(name: string): Promise<string>;
  getContent(ref: PackageRef): Promise<Uint8Array>;
  getPackage(ref: PackageRef): Promise<InstalledPackage>;
  getSources(ref: PackageRef): Promise<PackageSource[]>;
  getContents(ref: PackageRef): Promise<PackageContents>;
  resolveClosure(rootDeps: readonly string[]): Promise<ResolvedClosure>;
  publish(compiledDir: string): Promise<void>;
  deleteVersion(name: string, version: string): Promise<void>;
  resolveResolved(ref: DomainPackageRef): Promise<ResolvedPackage>;
  resolvedVersions(id: string): Promise<string[]>;
}

/** The subset of `PackageCompiler` the bridge uses (structurally satisfied by it).
 *  Compiling a directory is a Compiler concern — kept separate from the
 *  PackageManager, which only handles registry / compiled / published packages. */
export interface PackageCompilerLike {
  compile(directory: string, options?: { scope?: string; outDir?: string }): Promise<CompileResult>;
}

/** A directory compile result, serialized for the renderer. The compiled output
 *  is written to `outDir`; on success that directory is what `publishDir` takes. */
export interface CompileResultView {
  ok: boolean;
  outDir: string;
  files: string[];
  diagnostics: { severity: string; message: string }[];
  /** The TODL package id (the LocalPackageStore / Domain `model` key). */
  id?: string;
  name?: string;
  version?: string;
  sourceCount?: number;
}

/** What `config:get` returns — never the token value (the env-var *name* is not
 *  a secret and is returned so the Setup page can show the current source). */
export interface ConfigView {
  registry: string;
  scope: string;
  org: string;
  tokenSource: TokenSource;
  tokenEnvVar: string;
  hasToken: boolean;
}

export interface RegistryBridgeDeps {
  tokenStore: TokenStore;
  settingsStore: SettingsStore;
  /** Build a manager from a resolved config (prod: (c) => new PackageManager(c)). */
  createManager(config: NpmRegistryConfig): PackageManagerLike;
  /** Build the directory compiler (prod: () => new PackageCompiler()). */
  createCompiler(): PackageCompilerLike;
  /** The shared local compiled-package store — compileDir registers into it and
   *  resolvePackage reads from it (local-first). Owned by main/index.ts. */
  localStore: LocalPackageStore;
  /** The process environment, for env-var tokens (prod: `process.env`). */
  env: Record<string, string | undefined>;
}

export class RegistryBridge {
  constructor(private readonly deps: RegistryBridgeDeps) {}

  list(): Promise<string[]> {
    return this.manager().list();
  }

  versions(name: string): Promise<VersionList> {
    return this.manager().versions(name);
  }

  getContent(ref: PackageRef): Promise<Uint8Array> {
    return this.manager().getContent(ref);
  }

  getPackage(ref: PackageRef): Promise<InstalledPackage> {
    return this.manager().getPackage(ref);
  }

  resolveClosure(rootDeps: readonly string[]): Promise<ResolvedClosure> {
    return this.manager().resolveClosure(rootDeps);
  }

  getMeta(name: string): Promise<string> {
    return this.manager().manifestKind(name);
  }

  publishDir(dir: string): Promise<void> {
    return this.manager().publish(dir);
  }

  /** Delete a published version from the registry (reaction to a 409 conflict). */
  deleteVersion(name: string, version: string): Promise<void> {
    return this.manager().deleteVersion(name, version);
  }

  /** Bump the opened project's version to the next unused patch and persist it to
   *  `project.plexus`, returning the new version. The caller then recompiles +
   *  republishes. The publishable version lives in `modelVersion` (a meta-model)
   *  or `libVersion` (a library); `project.plexus` is plain JSON. */
  async bumpVersion(dir: string): Promise<string> {
    const manifestPath = join(dir, "project.plexus");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as
      { type?: string; id?: string; modelVersion?: string; libVersion?: string };
    const field = manifest.type === "meta-model" ? "modelVersion" : "libVersion";
    const current = manifest[field] ?? "0.0.0";
    const scope = this.deps.settingsStore.get().scope;
    const name = `${scope}/${manifest.id ?? ""}`;
    const published = await this.manager().versions(name).then((v) => v.versions).catch(() => [] as string[]);
    const next = RegistryBridge.nextUnusedPatch(current, published);
    manifest[field] = next;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    return next;
  }

  /** The next unused patch: patch+1 above the highest of `current` ∪ `published`,
   *  skipping any already taken. Non-`major.minor.patch` inputs are ignored. */
  private static nextUnusedPatch(current: string, published: readonly string[]): string {
    const parse = (v: string): [number, number, number] | undefined => {
      const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
      return m === null ? undefined : [Number(m[1]), Number(m[2]), Number(m[3])];
    };
    const cmp = (a: readonly number[], b: readonly number[]): number => a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!;
    let best: [number, number, number] = parse(current) ?? [0, 0, 0];
    for (const v of published) {
      const p = parse(v);
      if (p !== undefined && cmp(p, best) > 0) best = p;
    }
    const taken = new Set(published);
    let candidate: [number, number, number] = [best[0], best[1], best[2] + 1];
    while (taken.has(candidate.join("."))) candidate = [candidate[0], candidate[1], candidate[2] + 1];
    return candidate.join(".");
  }

  /** Compile a project directory into a package under `<dir>/dist`, returning a
   *  serializable view (identity, files written, diagnostics). On success the
   *  `outDir` is what `publishDir` publishes. Compilation throws for a non-
   *  compilable manifest (e.g. an architecture) or an unresolvable dependency;
   *  a failing compile (source errors) returns `ok: false` with diagnostics. */
  async compileDir(dir: string): Promise<CompileResultView> {
    const outDir = join(dir, "dist");
    const result = await this.deps.createCompiler().compile(dir, { outDir });
    const pkg = result.package;
    // Register the freshly-compiled package so the solution's Domain can resolve
    // it locally (before any publish).
    if (result.ok && pkg !== undefined) this.deps.localStore.register(pkg);
    return {
      ok: result.ok,
      outDir,
      files: result.files !== undefined ? [...result.files] : [],
      diagnostics: result.diagnostics.map((d) => ({ severity: String(d.severity), message: d.message })),
      id: pkg?.id,
      name: pkg !== undefined ? (pkg.name ?? pkg.id) : undefined,
      version: pkg?.version,
      sourceCount: pkg?.sources.length,
    };
  }

  /** Resolve a Domain ref to manifest bytes + deps + seed (local store first,
   *  network fallback). Backs the renderer's IpcPackageSource for solution
   *  composition. */
  resolvePackage(ref: DomainPackageRef): Promise<ResolvedPackage> {
    return this.manager().resolveResolved(ref);
  }

  /** Versions for a package id (local store unioned with the registry). */
  packageVersions(model: string): Promise<string[]> {
    return this.manager().resolvedVersions(model);
  }

  getSources(ref: PackageRef): Promise<PackageSource[]> {
    return this.manager().getSources(ref);
  }

  /** Everything a package's tarball carries (sources, manifest, meta, compiled +
   *  raw model, deps, versions) from one fetch — backs the content tree. */
  getPackageContents(name: string): Promise<PackageContents> {
    return this.manager().getContents({ name });
  }

  async getConfig(): Promise<ConfigView> {
    const s = this.deps.settingsStore.get();
    return {
      registry: s.registry,
      scope: s.scope,
      org: s.org,
      tokenSource: s.tokenSource,
      tokenEnvVar: s.tokenEnvVar,
      hasToken: this.effectiveToken(s).length > 0,
    };
  }

  async setStoredToken(token: string): Promise<void> {
    this.deps.tokenStore.setToken(token);
    this.deps.settingsStore.update({ tokenSource: TokenSource.Stored });
  }

  async useEnvToken(varName: string): Promise<void> {
    this.deps.settingsStore.update({ tokenSource: TokenSource.Env, tokenEnvVar: varName });
  }

  async listEnvVars(): Promise<string[]> {
    return Object.keys(this.deps.env)
      .filter((k) => this.deps.env[k] !== undefined)
      .sort((a, b) => a.localeCompare(b));
  }

  async setSettings(partial: Partial<{ registry: string; scope: string; org: string; githubApi: string }>): Promise<void> {
    this.deps.settingsStore.update(partial);
  }

  /** The effective token for the current source: the env var's value, or the
   *  stored (encrypted) token. */
  private effectiveToken(settings: RegistrySettings = this.deps.settingsStore.get()): string {
    if (settings.tokenSource === TokenSource.Env) {
      return this.deps.env[settings.tokenEnvVar] ?? "";
    }
    return this.deps.tokenStore.getToken();
  }

  /** Build a manager from the current settings + effective token. */
  private manager(): PackageManagerLike {
    const s = this.deps.settingsStore.get();
    return this.deps.createManager({
      registry: s.registry,
      scope: s.scope,
      org: s.org,
      githubApi: s.githubApi,
      token: this.effectiveToken(s),
    });
  }
}
