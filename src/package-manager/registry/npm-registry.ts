/**
 * `NpmRegistry` — a self-contained wire client for an npm-compatible registry
 * (design: todl-package-manager, registry client). It speaks the registry HTTP
 * protocol directly (packument reads, tarball fetch, `PUT` publish) plus the
 * GitHub Packages REST API for cross-package listing — no `npm` CLI, no
 * `node_modules`. GitHub Packages (`npm.pkg.github.com`, the configured
 * `publishConfig.registry`) implements the same protocol.
 *
 * Auth is a single bearer token. All I/O goes through the injected
 * {@link HttpTransport}, so tests exercise the full protocol against an
 * in-memory fake.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { integrity, shasum, verifyIntegrity } from "./integrity.js";
import { createTgz, type TarEntry } from "./tar.js";
import { FetchTransport, type HttpResponse, type HttpTransport } from "./transport.js";

/** A package reference. `scope` defaults to the client's configured scope;
 *  `version` defaults to the `latest` dist-tag. `name` may be bare (`microsoft`)
 *  or already scoped (`@scope/microsoft`). */
export interface PackageRef {
  scope?: string;
  name: string;
  version?: string;
}

/** The published versions of a package: concrete versions plus dist-tag aliases. */
export interface VersionList {
  versions: string[];
  distTags: Record<string, string>;
}

/** The subset of a package.json the client needs to publish a version. Any extra
 *  fields (dependencies, the `todl` block, …) pass through into the version
 *  manifest verbatim. */
export interface PackageManifestJson {
  name: string;
  version: string;
  description?: string;
  [key: string]: unknown;
}

export interface NpmRegistryConfig {
  /** Registry base URL, e.g. `https://npm.pkg.github.com`. */
  registry: string;
  /** Default npm scope for bare package names, including the leading `@`. */
  scope: string;
  /** Bearer token for `Authorization`. */
  token: string;
  /** GitHub REST API base for {@link NpmRegistry.listPackages}. Default:
   *  `https://api.github.com`. */
  githubApi?: string;
  /** GitHub org owning the packages. Default: `scope` without its leading `@`. */
  org?: string;
  /** Transport seam. Default: {@link FetchTransport}. */
  transport?: HttpTransport;
}

/** The shape of a packument (registry metadata document) we read. Each version
 *  entry is the published manifest (incl. any `todl` block) plus its `dist`. */
interface Packument {
  "dist-tags"?: Record<string, string>;
  versions?: Record<string, PackageManifestJson & { dist?: { tarball?: string; integrity?: string } }>;
}

const decoder = new TextDecoder();

/** Encode a package name for a registry URL path (`@scope/name` → `@scope%2Fname`). */
function encodeName(name: string): string {
  return name.replace("/", "%2F");
}

export class NpmRegistry {
  private readonly registry: string;
  private readonly scope: string;
  private readonly token: string;
  private readonly githubApi: string;
  private readonly org: string;
  private readonly transport: HttpTransport;

  constructor(config: NpmRegistryConfig) {
    this.registry = config.registry.replace(/\/+$/, "");
    this.scope = config.scope;
    this.token = config.token;
    this.githubApi = (config.githubApi ?? "https://api.github.com").replace(/\/+$/, "");
    this.org = config.org ?? config.scope.replace(/^@/, "");
    this.transport = config.transport ?? new FetchTransport();
  }

  /** List every TODL/npm package name published under the org, via the GitHub
   *  Packages REST API. Requires a token with `read:packages`. Returns bare names
   *  (no scope), following pagination to completion. */
  async listPackages(): Promise<string[]> {
    const names: string[] = [];
    for (let page = 1; ; page++) {
      const url = `${this.githubApi}/orgs/${this.org}/packages?package_type=npm&per_page=100&page=${page}`;
      const res = await this.transport.request({ method: "GET", url, headers: this.githubHeaders() });
      if (res.status !== 200) throw new Error(`list packages failed: HTTP ${res.status} ${text(res)}`);
      const batch = JSON.parse(text(res)) as Array<{ name: string }>;
      for (const entry of batch) names.push(entry.name);
      if (batch.length < 100) break;
    }
    return names;
  }

  /** List a package's published versions and dist-tags (registry packument). */
  async listVersions(name: string): Promise<VersionList> {
    const packument = await this.packument(this.qualify({ name }));
    return {
      versions: Object.keys(packument.versions ?? {}),
      distTags: packument["dist-tags"] ?? {},
    };
  }

  /** Fetch a package's tarball bytes for a ref, verifying SRI integrity. */
  async getContent(ref: PackageRef): Promise<Uint8Array> {
    const name = this.qualify(ref);
    const packument = await this.packument(name);
    const version = this.resolveVersion(packument, name, ref.version);
    const dist = packument.versions?.[version]?.dist;
    if (dist?.tarball === undefined) throw new Error(`no tarball for ${name}@${version}`);

    const res = await this.transport.request({ method: "GET", url: dist.tarball, headers: this.authHeaders() });
    if (res.status !== 200) throw new Error(`fetch tarball ${name}@${version} failed: HTTP ${res.status}`);
    if (dist.integrity !== undefined && !verifyIntegrity(res.body, dist.integrity)) {
      throw new Error(`integrity check failed for ${name}@${version}`);
    }
    return res.body;
  }

  /** Read a package's resolved version manifest from the packument (no tarball
   *  download). Includes any published fields such as the `todl` block. */
  async getManifest(ref: PackageRef): Promise<PackageManifestJson> {
    const name = this.qualify(ref);
    const packument = await this.packument(name);
    const version = this.resolveVersion(packument, name, ref.version);
    const manifest = packument.versions?.[version];
    if (manifest === undefined) throw new Error(`no manifest for ${name}@${version}`);
    return manifest;
  }

  /** Publish a tarball for `manifest` (its parsed package.json) via a registry
   *  `PUT`. Computes integrity/shasum and embeds the tarball as an attachment. */
  async publish(manifest: PackageManifestJson, tarball: Uint8Array): Promise<void> {
    const { name, version } = manifest;
    // Key by the FULL (scoped) name, exactly as npm's libnpmpublish does:
    // `${manifest.name}-${version}.tgz`. GitHub Packages resolves the attachment
    // by this scoped key and rejects with "no attachments present in packument"
    // if it is unscoped (Verdaccio is lax and takes the first key regardless).
    const tarballFile = `${name}-${version}.tgz`;
    const tarballUrl = `${this.registry}/${name}/-/${tarballFile}`;

    const body = {
      _id: name,
      name,
      description: manifest.description ?? "",
      "dist-tags": { latest: version },
      versions: {
        [version]: {
          ...manifest,
          _id: `${name}@${version}`,
          dist: { integrity: integrity(tarball), shasum: shasum(tarball), tarball: tarballUrl },
        },
      },
      _attachments: {
        [tarballFile]: {
          content_type: "application/octet-stream",
          data: Buffer.from(tarball).toString("base64"),
          length: tarball.length,
        },
      },
    };

    const res = await this.transport.request({
      method: "PUT",
      url: `${this.registry}/${encodeName(name)}`,
      headers: { ...this.authHeaders(), "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`publish ${name}@${version} failed: HTTP ${res.status} ${text(res)}`);
    }
  }

  /** Read a packed package directory (a `FileSink`/pack output), tar+gzip it under
   *  `package/`, and publish it — the npm-free equivalent of `npm publish`. */
  async publishDir(distDir: string): Promise<void> {
    const files = readPackageDir(distDir);
    const manifestFile = files.find((f) => f.rel === "package.json");
    if (manifestFile === undefined) throw new Error(`no package.json in ${distDir}`);
    const manifest = JSON.parse(decoder.decode(manifestFile.bytes)) as PackageManifestJson;
    const entries: TarEntry[] = files.map((f) => ({ path: `package/${f.rel}`, bytes: f.bytes }));
    await this.publish(manifest, createTgz(entries));
  }

  /** Delete a published version via the GitHub Packages REST API: resolve the
   *  version's numeric id (npm packages are addressed by their UNSCOPED name
   *  under the org), then `DELETE` it. Requires a token with `delete:packages`.
   *  Registries other than GitHub Packages don't support this shape. */
  async deleteVersion(name: string, version: string): Promise<void> {
    const slash = name.indexOf("/");
    const pkg = slash < 0 ? name : name.slice(slash + 1);
    const base = `${this.githubApi}/orgs/${this.org}/packages/npm/${encodeURIComponent(pkg)}/versions`;
    const listRes = await this.transport.request({ method: "GET", url: base, headers: this.githubHeaders() });
    if (listRes.status !== 200) throw new Error(`list versions of ${name} failed: HTTP ${listRes.status} ${text(listRes)}`);
    const versions = JSON.parse(text(listRes)) as Array<{ id: number; name: string }>;
    const match = versions.find((v) => v.name === version);
    if (match === undefined) throw new Error(`${name}@${version} is not a published version`);
    const delRes = await this.transport.request({ method: "DELETE", url: `${base}/${match.id}`, headers: this.githubHeaders() });
    if (delRes.status < 200 || delRes.status >= 300) {
      throw new Error(`delete ${name}@${version} failed: HTTP ${delRes.status} ${text(delRes)}`);
    }
  }

  /** Qualify a ref's name with a scope unless it is already scoped. */
  private qualify(ref: PackageRef): string {
    if (ref.name.startsWith("@")) return ref.name;
    return `${ref.scope ?? this.scope}/${ref.name}`;
  }

  private async packument(name: string): Promise<Packument> {
    const res = await this.transport.request({
      method: "GET",
      url: `${this.registry}/${encodeName(name)}`,
      headers: this.authHeaders(),
    });
    if (res.status !== 200) throw new Error(`packument ${name} failed: HTTP ${res.status}`);
    return JSON.parse(text(res)) as Packument;
  }

  /** Resolve a ref version: a dist-tag alias, a concrete version, or `latest`. */
  private resolveVersion(packument: Packument, name: string, version?: string): string {
    const tags = packument["dist-tags"] ?? {};
    if (version === undefined) {
      if (tags["latest"] === undefined) throw new Error(`${name} has no latest dist-tag`);
      return tags["latest"];
    }
    if (tags[version] !== undefined) return tags[version];
    if (packument.versions?.[version] !== undefined) return version;
    throw new Error(`${name}@${version} not found`);
  }

  private authHeaders(): Record<string, string> {
    return { authorization: `Bearer ${this.token}` };
  }

  private githubHeaders(): Record<string, string> {
    return {
      authorization: `Bearer ${this.token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
    };
  }
}

/** Decode a response body as UTF-8 text. */
function text(res: HttpResponse): string {
  return decoder.decode(res.body);
}

interface PackageFile {
  rel: string;
  bytes: Uint8Array;
}

/** Read every file under `dir` recursively, with forward-slash relative paths. */
function readPackageDir(dir: string): PackageFile[] {
  const out: PackageFile[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push({ rel: relative(dir, full).split("\\").join("/"), bytes: new Uint8Array(readFileSync(full)) });
    }
  };
  walk(dir);
  return out;
}
