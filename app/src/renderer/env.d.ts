import type {
  PackageRef,
  VersionList,
  InstalledPackage,
  ResolvedClosure,
  PackageContents,
} from "@pragmatic-tech-ai/todl/package-manager";
import type { ConfigView, PackageSource, CompileResultView } from "../main/registry/registry-bridge.js";
import type { DirEntry } from "../main/registry/register-ipc.js";
import type { ResolvedPackage, PackageRef as DomainPackageRef } from "@pragmatic-tech-ai/todl/domain";

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
    resolvePackage(ref: DomainPackageRef): Promise<ResolvedPackage>;
    packageVersions(model: string): Promise<string[]>;
    getSources(ref: PackageRef): Promise<PackageSource[]>;
    getPackageContents(name: string): Promise<PackageContents>;
    deleteVersion(name: string, version: string): Promise<void>;
    bumpVersion(dir: string): Promise<string>;
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
  fs: {
    readDir(path: string): Promise<DirEntry[]>;
    readText(path: string): Promise<string>;
    readBytes(path: string): Promise<Uint8Array>;
    writeText(path: string, content: string): Promise<void>;
    writeBytes(path: string, bytes: Uint8Array): Promise<void>;
    exists(path: string): Promise<boolean>;
    delete(path: string): Promise<void>;
    mkdir(path: string): Promise<void>;
    rename(from: string, to: string): Promise<void>;
    list(path: string): Promise<DirEntry[]>;
    openExternal(path: string): Promise<void>;
  };
}

declare global {
  interface Window {
    todl: TodlBridge;
  }
}
