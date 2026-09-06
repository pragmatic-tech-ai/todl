import type {
  PackageRef,
  VersionList,
  InstalledPackage,
  ResolvedClosure,
} from "@pragmatic-tech-ai/todl/package-manager";
import type { ConfigView, PackageSource } from "../main/registry/registry-bridge.js";

export interface TodlBridge {
  registry: {
    list(): Promise<string[]>;
    versions(name: string): Promise<VersionList>;
    getContent(ref: PackageRef): Promise<Uint8Array>;
    getPackage(ref: PackageRef): Promise<InstalledPackage>;
    resolveClosure(rootDeps: string[]): Promise<ResolvedClosure>;
    publishDir(dir: string): Promise<void>;
    getSources(ref: PackageRef): Promise<PackageSource[]>;
  };
  config: {
    get(): Promise<ConfigView>;
    setToken(token: string): Promise<void>;
    setSettings(partial: Partial<{ registry: string; scope: string; org: string; githubApi: string }>): Promise<void>;
  };
}

declare global {
  interface Window {
    todl: TodlBridge;
  }
}
