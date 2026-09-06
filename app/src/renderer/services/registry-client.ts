/**
 * `RegistryClient` — a typed wrapper over the `window.todl` bridge (design §5) so
 * renderer VMs depend on this class, not the global. Thin pass-through today; the
 * seam is where transferred-byte or shape conversion would live. IPC (structured
 * clone) preserves `Uint8Array`, so `getContent` needs no conversion yet.
 */
import type {
  PackageRef,
  VersionList,
  InstalledPackage,
  ResolvedClosure,
} from "@pragmatic-tech-ai/todl/package-manager";
import type { ConfigView } from "../../main/registry/registry-bridge.js";

export class RegistryClient {
  list(): Promise<string[]> {
    return window.todl.registry.list();
  }
  versions(name: string): Promise<VersionList> {
    return window.todl.registry.versions(name);
  }
  getContent(ref: PackageRef): Promise<Uint8Array> {
    return window.todl.registry.getContent(ref);
  }
  getPackage(ref: PackageRef): Promise<InstalledPackage> {
    return window.todl.registry.getPackage(ref);
  }
  resolveClosure(rootDeps: string[]): Promise<ResolvedClosure> {
    return window.todl.registry.resolveClosure(rootDeps);
  }
  getConfig(): Promise<ConfigView> {
    return window.todl.config.get();
  }
  setToken(token: string): Promise<void> {
    return window.todl.config.setToken(token);
  }
  setSettings(partial: Partial<{ registry: string; scope: string; org: string; githubApi: string }>): Promise<void> {
    return window.todl.config.setSettings(partial);
  }
}
