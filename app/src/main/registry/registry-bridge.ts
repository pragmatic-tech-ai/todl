/**
 * `RegistryBridge` — the logic behind the `registry:*` / `config:*` IPC channels
 * (design §5). Pure over injected collaborators (a registry factory, the tar
 * reader, the closure resolver, and the two stores) so it unit-tests with no
 * running Electron. `main/index.ts` constructs it with the real package-manager
 * symbols and wires each method to `ipcMain.handle`. Package-manager symbols are
 * type-only imports here, so the test runner needs no bundler alias.
 */
import type { TokenStore } from "./token-store.js";
import type { SettingsStore } from "./settings-store.js";
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

/** What `config:get` returns — never the token. */
export interface ConfigView {
  registry: string;
  scope: string;
  org: string;
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
}

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

  async getConfig(): Promise<ConfigView> {
    const s = this.deps.settingsStore.get();
    return { registry: s.registry, scope: s.scope, org: s.org, hasToken: this.deps.tokenStore.hasToken() };
  }

  async setToken(token: string): Promise<void> {
    this.deps.tokenStore.setToken(token);
  }

  async setSettings(partial: Partial<{ registry: string; scope: string; org: string; githubApi: string }>): Promise<void> {
    this.deps.settingsStore.update(partial);
  }

  /** Build a registry client from the current settings + token. */
  private registry(): RegistryLike {
    const s = this.deps.settingsStore.get();
    return this.deps.createRegistry({
      registry: s.registry,
      scope: s.scope,
      org: s.org,
      githubApi: s.githubApi,
      token: this.deps.tokenStore.getToken(),
    });
  }
}
