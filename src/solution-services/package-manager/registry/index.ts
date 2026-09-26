/** The registry wire client — a self-contained npm-compatible registry client
 *  (design: todl-package-manager, registry client). Lists, publishes, and fetches
 *  package tarballs over HTTP with no `npm` CLI. */
export {
  NpmRegistry,
  type NpmRegistryConfig,
  type PackageRef,
  type VersionList,
  type PackageManifestJson,
} from "./npm-registry.js";
export {
  type HttpTransport,
  type HttpRequest,
  type HttpResponse,
  FetchTransport,
  HttpTransportKey,
} from "./transport.js";
export { createTgz, type TarEntry } from "./tar.js";
export { TarReader, type TarFile } from "./tar-reader.js";
// Browser-safe (no node builtins): the shared USTAR layout, the async web-stream
// `.tgz` codec, and the IStorage package packer the publish build action uses.
export { TarArchive } from "./tar-archive.js";
export { WebTgz } from "./web-tgz.js";
export { StoragePackagePacker } from "./storage-package-packer.js";
export { integrity, shasum, verifyIntegrity } from "./integrity.js";
