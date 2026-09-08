import { test } from "node:test";
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PackageManager } from "../package-manager.js";
import { NpmRegistry, createTgz, type HttpRequest, type HttpResponse, type HttpTransport } from "../registry/index.js";

const REGISTRY = "https://npm.example";
const GITHUB = "https://api.example";
const SCOPE = "@pragmatic-tech-ai";
const enc = new TextEncoder();

/** An in-memory npm registry + GitHub Packages API (same 4 routes the client speaks). */
class FakeRegistry implements HttpTransport {
  private readonly packuments = new Map<string, Record<string, unknown>>();
  private readonly tarballs = new Map<string, Uint8Array>();
  private readonly packageNames = new Set<string>();

  request(req: HttpRequest): Promise<HttpResponse> {
    if (req.url.startsWith(`${GITHUB}/orgs/`)) return Promise.resolve(this.json([...this.packageNames].map((name) => ({ name }))));
    if (req.url.includes("/-/")) {
      const bytes = this.tarballs.get(req.url);
      return Promise.resolve(bytes === undefined ? this.json({ error: "nf" }, 404) : { status: 200, headers: {}, body: bytes });
    }
    const key = req.url.slice(REGISTRY.length + 1);
    if (req.method === "PUT") return Promise.resolve(this.put(key, req));
    const packument = this.packuments.get(key);
    return Promise.resolve(packument === undefined ? this.json({ error: "nf" }, 404) : this.json(packument));
  }
  private put(key: string, req: HttpRequest): HttpResponse {
    const body = JSON.parse(req.body as string) as {
      name: string; "dist-tags": Record<string, string>;
      versions: Record<string, { dist: { tarball: string } }>;
      _attachments: Record<string, { data: string }>;
    };
    const existing = this.packuments.get(key) ?? { name: body.name, "dist-tags": {}, versions: {} };
    Object.assign(existing["dist-tags"] as object, body["dist-tags"]);
    Object.assign(existing["versions"] as object, body.versions);
    this.packuments.set(key, existing);
    for (const [file, att] of Object.entries(body._attachments)) {
      const v = Object.entries(body.versions).find(([, ver]) => ver.dist.tarball.endsWith(file));
      if (v !== undefined) this.tarballs.set(v[1].dist.tarball, new Uint8Array(Buffer.from(att.data, "base64")));
    }
    const slash = body.name.indexOf("/");
    this.packageNames.add(slash < 0 ? body.name : body.name.slice(slash + 1));
    return { status: 201, headers: {}, body: enc.encode("{}") };
  }
  private json(value: unknown, status = 200): HttpResponse {
    return { status, headers: {}, body: enc.encode(JSON.stringify(value)) };
  }
}

/** Publish a compiled TODL package (package.json incl. todl + deps, model.json, src/**). */
async function publishPackage(
  registry: NpmRegistry,
  id: string,
  version: string,
  todl: { kind: string; id: string },
  deps: Record<string, string> = {},
  src: Record<string, string> = {},
): Promise<void> {
  const files = [
    { path: "package/package.json", bytes: enc.encode(JSON.stringify({ name: `${SCOPE}/${id}`, version, todl, dependencies: deps })) },
    { path: "package/model.json", bytes: enc.encode(JSON.stringify({ nodes: [] })) },
    ...Object.entries(src).map(([name, text]) => ({ path: `package/src/${name}`, bytes: enc.encode(text) })),
  ];
  // The manifest PUT to the registry carries todl + deps too (as publishDir does),
  // so getManifest/manifestKind can read them without a tarball download.
  await registry.publish({ name: `${SCOPE}/${id}`, version, todl, dependencies: deps } as never, createTgz(files));
}

function manager(transport: HttpTransport): PackageManager {
  return new PackageManager({ registry: REGISTRY, scope: SCOPE, token: "t", githubApi: GITHUB, transport });
}
function seeder(transport: HttpTransport): NpmRegistry {
  return new NpmRegistry({ registry: REGISTRY, scope: SCOPE, token: "t", githubApi: GITHUB, transport });
}

test("list and versions report published packages", async () => {
  const fake = new FakeRegistry();
  const seed = seeder(fake);
  await publishPackage(seed, "aws", "0.1.0", { kind: "library", id: "aws" });
  await publishPackage(seed, "aws", "0.2.0", { kind: "library", id: "aws" });
  await publishPackage(seed, "microsoft", "0.1.0", { kind: "library", id: "microsoft" });

  const pm = manager(fake);
  assert.deepEqual((await pm.list()).sort(), ["aws", "microsoft"]);
  const versions = await pm.versions("aws");
  assert.deepEqual(versions.versions.sort(), ["0.1.0", "0.2.0"]);
  assert.equal(versions.distTags["latest"], "0.2.0");
});

test("manifestKind returns the todl kind, empty string when absent", async () => {
  const fake = new FakeRegistry();
  const seed = seeder(fake);
  await publishPackage(seed, "aws", "0.1.0", { kind: "library", id: "aws" });
  // A non-TODL npm package: publish a version with no todl block.
  await seed.publish({ name: `${SCOPE}/plain`, version: "1.0.0" } as never, createTgz([{ path: "package/package.json", bytes: enc.encode(JSON.stringify({ name: `${SCOPE}/plain`, version: "1.0.0" })) }]));

  const pm = manager(fake);
  assert.equal(await pm.manifestKind("aws"), "library");
  assert.equal(await pm.manifestKind("plain"), "");
});

test("getPackage parses a compiled package; throws for a non-TODL tarball", async () => {
  const fake = new FakeRegistry();
  const seed = seeder(fake);
  await publishPackage(seed, "aws", "0.1.0", { kind: "library", id: "aws" });
  await seed.publish({ name: `${SCOPE}/plain`, version: "1.0.0" } as never, createTgz([{ path: "package/readme", bytes: enc.encode("hi") }]));

  const pm = manager(fake);
  const pkg = await pm.getPackage({ name: "aws" });
  assert.equal(pkg.name, `${SCOPE}/aws`);
  assert.equal(pkg.meta.kind, "library");
  await assert.rejects(pm.getPackage({ name: "plain" }), /not a TODL package/);
});

test("getSources returns only package/src files, stripped to their uri", async () => {
  const fake = new FakeRegistry();
  const seed = seeder(fake);
  await publishPackage(seed, "aws", "0.1.0", { kind: "library", id: "aws" }, {}, {
    "aws.todl": "concept EC2;\n",
    "nested/more.todl": "concept S3;\n",
  });

  const sources = await manager(fake).getSources({ name: "aws" });
  assert.deepEqual(sources, [
    { name: "aws.todl", text: "concept EC2;\n" },
    { name: "nested/more.todl", text: "concept S3;\n" },
  ]);
});

test("getContents bundles sources, manifest, meta, model, deps + versions in one fetch", async () => {
  const fake = new FakeRegistry();
  const seed = seeder(fake);
  await publishPackage(seed, "aws", "0.1.0", { kind: "library", id: "aws" }, { "@pragmatic-tech-ai/base": "^1.0.0" }, {
    "aws.todl": "concept EC2;\n",
  });
  await publishPackage(seed, "aws", "0.2.0", { kind: "library", id: "aws" });

  const contents = await manager(fake).getContents({ name: "aws", version: "0.1.0" });
  assert.deepEqual(contents.files, [{ name: "aws.todl", text: "concept EC2;\n" }]);
  assert.deepEqual(contents.dependencies, ["@pragmatic-tech-ai/base"]);
  assert.equal(JSON.parse(contents.metadata).kind, "library");
  assert.deepEqual(JSON.parse(contents.compiled), { nodes: [] });
  assert.deepEqual(JSON.parse(contents.rawModel), { nodes: [] });
  assert.equal(JSON.parse(contents.packageJson).name, `${SCOPE}/aws`);
  assert.deepEqual(contents.versions.sort(), ["0.1.0", "0.2.0"]);
  assert.equal(contents.latest, "0.2.0");
});

test("resolveClosure BFS-fetches transitive deps then orders deps-first", async () => {
  const fake = new FakeRegistry();
  const seed = seeder(fake);
  await publishPackage(seed, "tech-architecture", "0.1.0", { kind: "meta-model", id: "tech-architecture" });
  await publishPackage(seed, "aws", "0.1.0", { kind: "library", id: "aws" }, { [`${SCOPE}/tech-architecture`]: "0.1.0" });

  const closure = await manager(fake).resolveClosure([`${SCOPE}/aws`]);
  assert.deepEqual(closure.order, [`${SCOPE}/tech-architecture`, `${SCOPE}/aws`]);
  assert.equal(closure.metaModels.length, 1);
  assert.equal(closure.libraries.length, 1);
});

test("get downloads a published tarball to a default filename", async () => {
  const fake = new FakeRegistry();
  const seed = seeder(fake);
  await publishPackage(seed, "aws", "0.1.0", { kind: "library", id: "aws" });

  const dir = mkdtempSync(join(tmpdir(), "todl-get-"));
  const out = join(dir, "aws.tgz");
  const written = await manager(fake).get("aws@0.1.0", out);
  assert.equal(written, out);
  assert.ok(existsSync(out));
  // The bytes are a valid gzip tarball containing the package.
  assert.match(new TextDecoder().decode(gunzipSync(readFileSync(out))), /package\/package\.json/);
});

test("publish PUTs an already-compiled directory", async () => {
  const dir = join(mkdtempSync(join(tmpdir(), "todl-pub-")), "dist");
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: `${SCOPE}/aws`, version: "0.1.0", todl: { kind: "library", id: "aws" } }));
  writeFileSync(join(dir, "model.json"), JSON.stringify({ nodes: [] }));
  writeFileSync(join(dir, "src", "aws.todl"), "concept EC2;\n");

  const fake = new FakeRegistry();
  await manager(fake).publish(dir);
  // Round-trips: the published package is now fetchable + parseable.
  const pkg = await manager(fake).getPackage({ name: "aws", version: "0.1.0" });
  assert.equal(pkg.name, `${SCOPE}/aws`);
});
