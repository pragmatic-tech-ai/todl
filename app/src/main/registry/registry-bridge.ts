/**
 * `RegistryBridge` — the logic behind the `registry:*` / `config:*` IPC channels
 * (design §5). Pure over injected collaborators (a registry factory, the tar
 * reader, the closure resolver, and the two stores) so it unit-tests with no
 * running Electron. `main/index.ts` constructs it with the real package-manager
 * symbols and wires each method to `ipcMain.handle`. Package-manager symbols are
 * type-only imports here, so the test runner needs no bundler alias.
 */
import type { TokenStore } from "./token-store.js";
import type { SettingsStore, RegistrySettings } from "./settings-store.js";
import { TokenSource } from "./settings-store.js";
import type {
  NpmRegistryConfig,
  PackageRef,
  VersionList,
  InstalledPackage,
  ResolvedClosure,
} from "@pragmatic-tech-ai/todl/package-manager";

/** The subset of `NpmRegistry` the bridge uses (structurally satisfied by it). */
export interface RegistryLike {
  listPackages(): Promise<string[]>;
  listVersions(name: string): Promise<VersionList>;
  getContent(ref: PackageRef): Promise<Uint8Array>;
  publishDir(dir: string): Promise<void>;
}

/** One authored source file recovered from a package tarball (`package/src/**`). */
export interface PackageSource {
  name: string;
  text: string;
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
  /** Build a registry client from a resolved config (prod: `new NpmRegistry(config)`). */
  createRegistry(config: NpmRegistryConfig): RegistryLike;
  /** Interpret tarball bytes as an installed package (prod: `TarReader.readPackage`). */
  readPackage(bytes: Uint8Array): InstalledPackage | undefined;
  /** Resolve a dependency closure (prod: the package-manager `resolveClosure`). */
  resolveClosure(packages: readonly InstalledPackage[], rootDeps: readonly string[]): ResolvedClosure;
  /** Read every file from tarball bytes (prod: `TarReader.read`). */
  readFiles(bytes: Uint8Array): { path: string; bytes: Uint8Array }[];
  /** The process environment, for env-var tokens (prod: `process.env`). */
  env: Record<string, string | undefined>;
}

const SRC_PREFIX = "package/src/";
const decoder = new TextDecoder();

export class RegistryBridge {
  constructor(private readonly deps: RegistryBridgeDeps) {}

  async list(): Promise<string[]> {
    return this.registry().listPackages();
  }

  async versions(name: string): Promise<VersionList> {
    return this.registry().listVersions(name);
  }

  async getContent(ref: PackageRef): Promise<Uint8Array> {
    return this.registry().getContent(ref);
  }

  async getPackage(ref: PackageRef): Promise<InstalledPackage> {
    const pkg = this.deps.readPackage(await this.registry().getContent(ref));
    if (pkg === undefined) throw new Error(`${ref.name} is not a TODL package`);
    return pkg;
  }

  async resolveClosure(rootDeps: readonly string[]): Promise<ResolvedClosure> {
    const registry = this.registry();
    const collected: InstalledPackage[] = [];
    const seen = new Set<string>();
    const queue = [...rootDeps];
    while (queue.length > 0) {
      const name = queue.shift() as string;
      if (seen.has(name)) continue;
      seen.add(name);
      const pkg = this.deps.readPackage(await registry.getContent({ name }));
      if (pkg === undefined) continue; // a non-TODL npm dependency; ignore
      collected.push(pkg);
      for (const dep of pkg.dependencies) if (!seen.has(dep)) queue.push(dep);
    }
    return this.deps.resolveClosure(collected, rootDeps);
  }

  async publishDir(dir: string): Promise<void> {
    return this.registry().publishDir(dir);
  }

  async getSources(ref: PackageRef): Promise<PackageSource[]> {
    const bytes = await this.registry().getContent(ref);
    return this.deps
      .readFiles(bytes)
      .filter((f) => f.path.startsWith(SRC_PREFIX))
      .map((f) => ({ name: f.path.slice(SRC_PREFIX.length), text: decoder.decode(f.bytes) }));
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

  /** Build a registry client from the current settings + effective token. */
  private registry(): RegistryLike {
    const s = this.deps.settingsStore.get();
    return this.deps.createRegistry({
      registry: s.registry,
      scope: s.scope,
      org: s.org,
      githubApi: s.githubApi,
      token: this.effectiveToken(s),
    });
  }
}
