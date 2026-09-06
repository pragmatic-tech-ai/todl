/**
 * `RegistryClient` — a typed wrapper over the `window.todl` bridge (design §5) so
 * renderer VMs depend on this class, not the global. Thin pass-through today; the
 * seam is where transferred-byte or shape conversion would live. IPC (structured
 * clone) preserves `Uint8Array`, so `getContent` needs no conversion yet.
 *
 * `bridge()` reads `window.__todlBridge` first, falling back to the real
 * `window.todl`. `contextBridge` deep-freezes `window.todl`, so an e2e cannot
 * replace it — the mutable `__todlBridge` global is the injection point for tests
 * (never set in production).
 */
import type {
  PackageRef,
  VersionList,
  InstalledPackage,
  ResolvedClosure,
} from "@pragmatic-tech-ai/todl/package-manager";
import type { ConfigView, PackageSource } from "../../main/registry/registry-bridge.js";
import type { TodlBridge } from "../env.js";

export class RegistryClient {
  private bridge(): TodlBridge {
    return (window as unknown as { __todlBridge?: TodlBridge }).__todlBridge ?? window.todl;
  }
  list(): Promise<string[]> {
    return this.bridge().registry.list();
  }
  versions(name: string): Promise<VersionList> {
    return this.bridge().registry.versions(name);
  }
  getContent(ref: PackageRef): Promise<Uint8Array> {
    return this.bridge().registry.getContent(ref);
  }
  getPackage(ref: PackageRef): Promise<InstalledPackage> {
    return this.bridge().registry.getPackage(ref);
  }
  getSources(ref: PackageRef): Promise<PackageSource[]> {
    return this.bridge().registry.getSources(ref);
  }
  resolveClosure(rootDeps: string[]): Promise<ResolvedClosure> {
    return this.bridge().registry.resolveClosure(rootDeps);
  }
  getConfig(): Promise<ConfigView> {
    return this.bridge().config.get();
  }
  setToken(token: string): Promise<void> {
    return this.bridge().config.setToken(token);
  }
  setSettings(partial: Partial<{ registry: string; scope: string; org: string; githubApi: string }>): Promise<void> {
    return this.bridge().config.setSettings(partial);
  }
}
