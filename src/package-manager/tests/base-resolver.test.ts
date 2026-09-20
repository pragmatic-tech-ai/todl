import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NpmRegistry, createTgz, type HttpRequest, type HttpResponse, type HttpTransport } from "../registry/index.js";
import { parseManifest } from "../manifest.js";
import { RegistryBaseResolver } from "../base-resolver.js";

const SCOPE = "@pragmatic-tech-ai";
const REGISTRY = "https://reg.example";
const enc = new TextEncoder();

/** Minimal in-memory registry (publish → getContent), mirroring npm-registry.test. */
class FakeRegistry implements HttpTransport
{
  private readonly packuments = new Map<string, Record<string, unknown>>();
  private readonly tarballs = new Map<string, Uint8Array>();
  request(req: HttpRequest): Promise<HttpResponse>
  {
    if (req.url.includes("/-/"))
    {
      const bytes = this.tarballs.get(req.url);
      return Promise.resolve(bytes === undefined ? this.notFound() : { status: 200, headers: {}, body: bytes });
    }
    const key = req.url.slice(REGISTRY.length + 1);
    if (req.method === "PUT")
    {
      const body = JSON.parse(req.body as string) as {
        name: string;
        "dist-tags": Record<string, string>;
        versions: Record<string, { dist: { tarball: string } }>;
        _attachments: Record<string, { data: string }>;
      };
      const existing = this.packuments.get(key) ?? { name: body.name, "dist-tags": {}, versions: {} };
      Object.assign(existing["dist-tags"] as object, body["dist-tags"]);
      Object.assign(existing["versions"] as object, body.versions);
      this.packuments.set(key, existing);
      for (const [file, att] of Object.entries(body._attachments))
      {
        const v = Object.entries(body.versions).find(([, val]) => val.dist.tarball.endsWith(file));
        if (v) this.tarballs.set(v[1].dist.tarball, new Uint8Array(Buffer.from(att.data, "base64")));
      }
      return Promise.resolve({ status: 201, headers: {}, body: enc.encode("{}") });
    }
    const p = this.packuments.get(key);
    return Promise.resolve(p === undefined ? this.notFound() : { status: 200, headers: {}, body: enc.encode(JSON.stringify(p)) });
  }
  private notFound(): HttpResponse
  {
    return { status: 404, headers: {}, body: enc.encode("{}") };
  }
}

function registry(transport: HttpTransport): NpmRegistry
{
  return new NpmRegistry({ registry: REGISTRY, scope: SCOPE, token: "t", transport });
}

/** Publish a TODL package (todl block + model.json) into a fake registry. */
async function publishPkg(reg: NpmRegistry, id: string, deps: Record<string, string>, model: unknown): Promise<void>
{
  const packageJson = { name: `${SCOPE}/${id}`, version: "0.1.0", todl: { kind: "library", id }, dependencies: deps };
  await reg.publish(packageJson as never, createTgz([
    { path: "package/package.json", bytes: enc.encode(JSON.stringify(packageJson)) },
    { path: "package/model.json", bytes: enc.encode(JSON.stringify(model)) },
  ]));
}

/** A library manifest declaring one meta-model dependency (id `meta`). */
const libManifest = () =>
  parseManifest(JSON.stringify({ type: "library", name: "lib", version: 1, id: "lib", libVersion: "0.1.0", metaModel: { id: "meta", version: "0.1.0" } }));

test("resolves an installed dependency offline (no registry hit)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "todl-res-"));
  const depDir = join(dir, "node_modules", SCOPE, "meta");
  mkdirSync(depDir, { recursive: true });
  writeFileSync(join(depDir, "package.json"), JSON.stringify({ name: `${SCOPE}/meta`, todl: { kind: "meta-model", id: "meta" }, dependencies: {} }));
  writeFileSync(join(depDir, "model.json"), JSON.stringify({ nodes: [{ id: "m1" }], edges: [] }));

  const bases = await new RegistryBaseResolver(() => undefined).resolve(dir, libManifest(), SCOPE);
  assert.equal(bases.length, 1);
  assert.deepEqual(bases[0]!.nodes, [{ id: "m1" }]);
});

test("fetches a not-installed dependency from the registry", async () => {
  const dir = mkdtempSync(join(tmpdir(), "todl-res-")); // empty node_modules
  const reg = registry(new FakeRegistry());
  await publishPkg(reg, "meta", {}, { nodes: [{ id: "m1" }], edges: [] });

  const bases = await new RegistryBaseResolver(() => reg).resolve(dir, libManifest(), SCOPE);
  assert.equal(bases.length, 1);
  assert.deepEqual(bases[0]!.nodes, [{ id: "m1" }]);
});

test("throws naming a dependency resolvable from neither source", async () => {
  const dir = mkdtempSync(join(tmpdir(), "todl-res-"));
  await assert.rejects(
    new RegistryBaseResolver(() => undefined).resolve(dir, libManifest(), SCOPE),
    /cannot resolve dependency "@pragmatic-tech-ai\/meta"/,
  );
});
