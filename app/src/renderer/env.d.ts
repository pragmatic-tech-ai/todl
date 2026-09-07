import type {
  PackageRef,
  VersionList,
  InstalledPackage,
  ResolvedClosure,
} from "@pragmatic-tech-ai/todl/package-manager";
import type { ConfigView, PackageSource, CompileResultView } from "../main/registry/registry-bridge.js";

export interface TodlBridge {
  registry: {
    list(): Promise<string[]>;
    versions(name: string): Promise<VersionList>;
    getContent(ref: PackageRef): Promise<Uint8Array>;
    getPackage(ref: PackageRef): Promise<InstalledPackage>;
    getMeta(name: string): Promise<string>;
    resolveClosure(rootDeps: string[]): Promise<ResolvedClosure>;
    publishDir(dir: string): Promise<void>;
    compileDir(dir: string): Promise<CompileResultView>;
    getSources(ref: PackageRef): Promise<PackageSource[]>;
  };
  config: {
    get(): Promise<ConfigView>;
    setToken(token: string): Promise<void>;
    useEnvToken(name: string): Promise<void>;
    listEnvVars(): Promise<string[]>;
    setSettings(partial: Partial<{ registry: string; scope: string; org: string; githubApi: string }>): Promise<void>;
  };
  dialog: {
    pickDirectory(): Promise<string>;
  };
}

declare global {
  interface Window {
    todl: TodlBridge;
  }
}
