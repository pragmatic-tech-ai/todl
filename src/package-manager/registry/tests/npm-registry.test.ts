import { test } from "node:test";
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NpmRegistry, createTgz, type HttpRequest, type HttpResponse, type HttpTransport } from "../index.js";

const REGISTRY = "https://npm.example";
const GITHUB = "https://api.example";
const SCOPE = "@pragmatic-tech-ai";

const enc = new TextEncoder();
const dec = new TextDecoder();
const json = (value: unknown, status = 200): HttpResponse => ({
  status,
  headers: {},
  body: enc.encode(JSON.stringify(value)),
});

/**
 * An in-memory npm registry + GitHub Packages API. Understands the four routes the
 * client speaks: PUT/GET packument, GET tarball, GET org package list. This is the
 * whole protocol the client depends on — driving it here exercises the real wire
 * shapes with no network.
 */
class FakeRegistry implements HttpTransport {
  private readonly packuments = new Map<string, Record<string, unknown>>();
  private readonly tarballs = new Map<string, Uint8Array>();
  private readonly packageNames = new Set<string>();

  request(req: HttpRequest): Promise<HttpResponse> {
    if (req.url.startsWith(`${GITHUB}/orgs/`)) return Promise.resolve(this.listPackages());
    if (req.url.includes("/-/")) return Promise.resolve(this.getTarball(req.url));
    const key = req.url.slice(REGISTRY.length + 1); // encoded package name
    return Promise.resolve(req.method === "PUT" ? this.put(key, req) : this.getPackument(key));
  }

  private put(key: string, req: HttpRequest): HttpResponse {
    const body = JSON.parse(req.body as string) as {
      name: string;
      "dist-tags": Record<string, string>;
      versions: Record<string, { dist: { tarball: string } }>;
      _attachments: Record<string, { data: string }>;
    };
    // Merge versions/dist-tags into any existing packument (republish adds a version).
    const existing = this.packuments.get(key) ?? { name: body.name, "dist-tags": {}, versions: {} };
    Object.assign(existing["dist-tags"] as object, body["dist-tags"]);
    Object.assign(existing["versions"] as object, body.versions);
    this.packuments.set(key, existing);
    // Store each attachment under its version's tarball URL.
    for (const [file, attachment] of Object.entries(body._attachments)) {
      const version = Object.entries(body.versions).find(([, v]) => v.dist.tarball.endsWith(file));
      if (version !== undefined) this.tarballs.set(version[1].dist.tarball, new Uint8Array(Buffer.from(attachment.data, "base64")));
    }
    this.packageNames.add(unscoped(body.name));
    return { status: 201, headers: {}, body: enc.encode("{}") };
  }

  private getPackument(key: string): HttpResponse {
    const packument = this.packuments.get(key);
    return packument === undefined ? json({ error: "not found" }, 404) : json(packument);
  }

  private getTarball(url: string): HttpResponse {
    const bytes = this.tarballs.get(url);
    return bytes === undefined ? json({ error: "not found" }, 404) : { status: 200, headers: {}, body: bytes };
  }

  private listPackages(): HttpResponse {
    return json([...this.packageNames].map((name) => ({ name })));
  }
}

function unscoped(name: string): string {
  const slash = name.indexOf("/");
  return slash < 0 ? name : name.slice(slash + 1);
}

function client(transport: HttpTransport): NpmRegistry {
  return new NpmRegistry({ registry: REGISTRY, scope: SCOPE, token: "t", githubApi: GITHUB, transport });
}

const manifest = (name: string, version: string) => ({ name: `${SCOPE}/${name}`, version });

test("publish then getContent round-trips the exact tarball bytes", async () => {
  const registry = client(new FakeRegistry());
  const tarball = createTgz([{ path: "package/hello.txt", bytes: enc.encode("hi") }]);

  await registry.publish(manifest("microsoft", "0.1.0"), tarball);

  const sameBytes = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));
  const fetched = await registry.getContent({ name: "microsoft", version: "0.1.0" });
  assert.ok(sameBytes(fetched, tarball), "fetched tarball bytes differ from published");
  // Version omitted → resolves the `latest` dist-tag to the same bytes.
  assert.ok(sameBytes(await registry.getContent({ name: "microsoft" }), tarball));
});

test("getContent rejects a tampered tarball via SRI integrity", async () => {
  const fake = new FakeRegistry();
  const registry = client(fake);
  await registry.publish(manifest("microsoft", "0.1.0"), createTgz([{ path: "package/a", bytes: enc.encode("a") }]));

  // Swap the stored bytes so they no longer match the published integrity.
  const tampering = client({
    request: (req) =>
      req.url.includes("/-/")
        ? Promise.resolve({ status: 200, headers: {}, body: enc.encode("corrupted") })
        : fake.request(req),
  });
  await assert.rejects(tampering.getContent({ name: "microsoft", version: "0.1.0" }), /integrity check failed/);
});

test("listVersions and listPackages report what was published", async () => {
  const registry = client(new FakeRegistry());
  const tar = createTgz([{ path: "package/a", bytes: enc.encode("a") }]);
  await registry.publish(manifest("microsoft", "0.1.0"), tar);
  await registry.publish(manifest("microsoft", "0.2.0"), tar);
  await registry.publish(manifest("aws", "1.0.0"), tar);

  const versions = await registry.listVersions("microsoft");
  assert.deepEqual(versions.versions.sort(), ["0.1.0", "0.2.0"]);
  assert.equal(versions.distTags["latest"], "0.2.0");

  const packages = await registry.listPackages();
  assert.deepEqual(packages.sort(), ["aws", "microsoft"]);
});

test("publishDir tars a packed directory and publishes it", async () => {
  const dir = join(mkdtempSync(join(tmpdir(), "todl-reg-")), "dist");
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: `${SCOPE}/microsoft`, version: "0.1.0" }));
  writeFileSync(join(dir, "model.json"), JSON.stringify({ nodes: [] }));
  writeFileSync(join(dir, "src", "microsoft.todl"), "concept X;\n");

  const registry = client(new FakeRegistry());
  await registry.publishDir(dir);

  const bytes = await registry.getContent({ name: "microsoft", version: "0.1.0" });
  const tar = dec.decode(gunzipSync(bytes));
  assert.match(tar, /package\/package\.json/);
  assert.match(tar, /package\/src\/microsoft\.todl/);
});
