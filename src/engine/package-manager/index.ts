/** The TODL package manager — wrapping npm/GitHub Packages
 *  (design: docs/superpowers/specs/2026-09-03-todl-package-manager-design.md).
 *  SP1: package format (manifest → package.json). */
export { ProjectType, type ProjectManifest, type DependencyRef, parseManifest } from "./manifest.js";
export {
  toPackageJson,
  DEFAULT_SCOPE,
  type PackageJson,
  type PackageJsonOptions,
  type TodlPackageMeta,
} from "./package-json.js";
export {
  PackageCompiler,
  NodeProjectReader,
  type ProjectReader,
  type SinkFactory,
  type CompileOptions,
  type CompileResult,
  type PackageCompilerDeps,
} from "./package-compiler.js";
export { RegistryBaseResolver, type BaseResolver, type RegistryFactory } from "./base-resolver.js";
export { PackageManager } from "./package-manager.js";
export {
  PackageRegistryClient,
  type PackageSource,
  type PackageContents,
} from "./package-registry-client.js";
export { LocalPackageStore } from "./local-package-store.js";
export { StoragePackageSource } from "./storage-package-source.js";
export { PackageManifestBridge } from "./package-manifest-bridge.js";
export { ProjectInstaller, type NpmRunner } from "./project-installer.js";
export { FileSink, MemorySink } from "./sinks.js";
export {
  resolveClosure,
  composeClosure,
  dependencyNames,
  type InstalledPackage,
  type ResolvedClosure,
} from "./resolve.js";
export { readInstalledPackages } from "./node-loader.js";
// The registry-engine abstraction (the type-keyed subsystem): the registry +
// connection contracts, the two factory kinds, the catalog, the host seams, and
// the PackageManagerService orchestrator.
export {
  type IPackageRegistry,
  type PublishablePackage,
  type ConnectionStatus,
} from "./engine/package-registry.js";
export {
  ConnectionFieldKind,
  type IPackageRegistryConnection,
  type ConnectionSpec,
  type ConnectionSettingField,
  type ConnectionPreset,
} from "./engine/registry-connection.js";
export {
  type IPackageRegistryFactory,
  type IPackageRegistryConnectionFactory,
} from "./engine/registry-factory.js";
export {
  PackageRegistryCatalog,
  PackageRegistryCatalogKey,
  type IPackageRegistryCatalog,
} from "./engine/package-registry-catalog.js";
export { ConnectionStoreKey, type IConnectionStore } from "./engine/connection-store.js";
export { SecretStoreKey, type ISecretStore } from "./engine/secret-store.js";
export { PackageManagerService, type PackageListing } from "./engine/package-manager-service.js";
// The npm registry type: its connections, the HTTP + local backends, the two
// factories, and the engine's default (npm-only) catalog.
export {
  NpmRegistryType,
  NpmConnectionKind,
  NpmRegistryConnection,
  LocalDirectoryConnection,
  type NpmConnection,
  type NpmHttpConnectionConfig,
} from "./registries/npm/npm-connection.js";
export { NpmHttpRegistry } from "./registries/npm/npm-http-registry.js";
export { LocalNpmRegistry } from "./registries/npm/local-npm-registry.js";
export { NpmPackageRegistryFactory } from "./registries/npm/npm-package-registry-factory.js";
export { NpmConnectionFactory } from "./registries/npm/npm-connection-factory.js";
export { DefaultPackageRegistryCatalog } from "./registries/npm/default-package-registry-catalog.js";
export { HttpTransportKey } from "./registry/index.js";
export { readProject, type Project } from "./project.js";
export { resolveRegistryConfig, type RegistryCliOptions } from "./registry/config.js";
export {
  NpmRegistry,
  type NpmRegistryConfig,
  type PackageRef,
  type VersionList,
  type PackageManifestJson,
  type HttpTransport,
  type HttpRequest,
  type HttpResponse,
  FetchTransport,
  createTgz,
  type TarEntry,
  TarReader,
  type TarFile,
  integrity,
  shasum,
  verifyIntegrity,
} from "./registry/index.js";
