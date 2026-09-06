import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RegistryBridge, type RegistryLike } from "../registry-bridge.js";
import { TokenStore, type Encryptor } from "../token-store.js";
import { SettingsStore } from "../settings-store.js";

class PlainEncryptor implements Encryptor {
  available() {
    return true;
  }
  encrypt(p: string) {
    return Buffer.from(p, "utf8");
  }
  decrypt(c: Buffer) {
    return c.toString("utf8");
  }
}
const freshDir = () => mkdtempSync(join(tmpdir(), "todl-bridge-"));
const enc = new TextEncoder();

/** A structural stand-in for NpmRegistry: serves a fixed catalog + tarball bytes. */
class FakeRegistry implements RegistryLike {
  constructor(
    private readonly names: string[],
    private readonly content: Map<string, Uint8Array>,
  ) {}
  listPackages() {
    return Promise.resolve(this.names);
  }
  listVersions(_name: string) {
    return Promise.resolve({ versions: ["0.1.0"], distTags: { latest: "0.1.0" } });
  }
  getContent(ref: { name: string }) {
    const bytes = this.content.get(ref.name);
    if (bytes === undefined) return Promise.reject(new Error(`no ${ref.name}`));
    return Promise.resolve(bytes);
  }
  publishDir() {
    return Promise.resolve();
  }
}

function makeBridge(
  registry: RegistryLike,
  readPackage = () => undefined as any,
  resolve = () => ({}) as any,
  readFiles: (bytes: Uint8Array) => { path: string; bytes: Uint8Array }[] = () => [],
) {
  const dir = freshDir();
  return new RegistryBridge({
    tokenStore: new TokenStore(dir, new PlainEncryptor()),
    settingsStore: new SettingsStore(dir),
    createRegistry: () => registry,
    readPackage,
    resolveClosure: resolve,
    readFiles,
  });
}

test("list delegates to the registry client", async () => {
  const bridge = makeBridge(new FakeRegistry(["aws", "microsoft"], new Map()));
  assert.deepEqual((await bridge.list()).sort(), ["aws", "microsoft"]);
});

test("getConfig reports settings + hasToken, never the token itself", async () => {
  const bridge = makeBridge(new FakeRegistry([], new Map()));
  let cfg = await bridge.getConfig();
  assert.equal(cfg.hasToken, false);
  assert.equal(cfg.scope, "@pragmatic-tech-ai");
  assert.ok(!("token" in cfg));
  await bridge.setToken("ghp_x");
  cfg = await bridge.getConfig();
  assert.equal(cfg.hasToken, true);
});

test("setSettings is reflected by a rebuilt registry config", async () => {
  let seenConfig: any;
  const dir = freshDir();
  const bridge = new RegistryBridge({
    tokenStore: new TokenStore(dir, new PlainEncryptor()),
    settingsStore: new SettingsStore(dir),
    createRegistry: (config) => {
      seenConfig = config;
      return new FakeRegistry([], new Map());
    },
    readPackage: () => undefined as any,
    resolveClosure: () => ({}) as any,
    readFiles: () => [],
  });
  await bridge.setSettings({ org: "acme" });
  await bridge.list();
  assert.equal(seenConfig.org, "acme");
});

test("resolveClosure BFS-fetches transitive deps then delegates to the pure resolver", async () => {
  // aws depends on tech-architecture; the bridge must fetch BOTH before resolving.
  const content = new Map<string, Uint8Array>([
    ["@pragmatic-tech-ai/aws", enc.encode("aws-bytes")],
    ["@pragmatic-tech-ai/tech-architecture", enc.encode("meta-bytes")],
  ]);
  const installed: Record<string, any> = {
    "aws-bytes": { name: "@pragmatic-tech-ai/aws", meta: { kind: "library", id: "aws" }, dependencies: ["@pragmatic-tech-ai/tech-architecture"], document: { nodes: [] } },
    "meta-bytes": { name: "@pragmatic-tech-ai/tech-architecture", meta: { kind: "meta-model", id: "tech-architecture" }, dependencies: [], document: { nodes: [] } },
  };
  const bridge = makeBridge(
    new FakeRegistry([], content),
    (bytes: Uint8Array) => installed[new TextDecoder().decode(bytes)],
    (pkgs: any[], roots: string[]) => ({ order: pkgs.map((p) => p.name), roots }),
  );
  const closure: any = await bridge.resolveClosure(["@pragmatic-tech-ai/aws"]);
  assert.deepEqual(closure.order.sort(), ["@pragmatic-tech-ai/aws", "@pragmatic-tech-ai/tech-architecture"]);
});

test("getSources returns only package/src files, stripped to their uri", async () => {
  const content = new Map<string, Uint8Array>([["@pragmatic-tech-ai/aws", enc.encode("aws-bytes")]]);
  const files = [
    { path: "package/package.json", bytes: enc.encode("{}") },
    { path: "package/model.json", bytes: enc.encode("{}") },
    { path: "package/src/aws.todl", bytes: enc.encode("concept EC2;\n") },
    { path: "package/src/nested/more.todl", bytes: enc.encode("concept S3;\n") },
  ];
  const bridge = makeBridge(new FakeRegistry([], content), () => undefined as any, () => ({}) as any, () => files);
  const sources = await bridge.getSources({ name: "@pragmatic-tech-ai/aws" });
  assert.deepEqual(sources, [
    { name: "aws.todl", text: "concept EC2;\n" },
    { name: "nested/more.todl", text: "concept S3;\n" },
  ]);
});

test("getPackage reads the fetched tarball into an InstalledPackage", async () => {
  const content = new Map<string, Uint8Array>([["@pragmatic-tech-ai/aws", enc.encode("aws-bytes")]]);
  const bridge = makeBridge(new FakeRegistry([], content), () => ({ name: "@pragmatic-tech-ai/aws", meta: { kind: "library", id: "aws" }, dependencies: [], document: { nodes: [] } }) as any);
  const pkg: any = await bridge.getPackage({ name: "@pragmatic-tech-ai/aws" });
  assert.equal(pkg.name, "@pragmatic-tech-ai/aws");
});
