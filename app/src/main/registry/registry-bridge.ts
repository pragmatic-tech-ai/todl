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
import type {
  NpmRegistryConfig,
  PackageRef,
  VersionList,
  InstalledPackage,
  ResolvedClosure,
  PackageSource,
  PackageContents,
  CompileResult,
} from "@pragmatic-tech-ai/todl/package-manager";

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

  /** Compile a project directory into a package under `<dir>/dist`, returning a
   *  serializable view (identity, files written, diagnostics). On success the
   *  `outDir` is what `publishDir` publishes. Compilation throws for a non-
   *  compilable manifest (e.g. an architecture) or an unresolvable dependency;
   *  a failing compile (source errors) returns `ok: false` with diagnostics. */
  async compileDir(dir: string): Promise<CompileResultView> {
    const outDir = join(dir, "dist");
    const result = await this.deps.createCompiler().compile(dir, { outDir });
    const pkg = result.package;
    return {
      ok: result.ok,
      outDir,
      files: result.files !== undefined ? [...result.files] : [],
      diagnostics: result.diagnostics.map((d) => ({ severity: String(d.severity), message: d.message })),
      name: pkg !== undefined ? (pkg.name ?? pkg.id) : undefined,
      version: pkg?.version,
      sourceCount: pkg?.sources.length,
    };
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
