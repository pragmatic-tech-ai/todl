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
} from "./transport.js";
export { createTgz, type TarEntry } from "./tar.js";
export { TarReader, type TarFile } from "./tar-reader.js";
export { integrity, shasum, verifyIntegrity } from "./integrity.js";
