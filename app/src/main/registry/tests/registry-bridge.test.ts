import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RegistryBridge, type PackageManagerLike } from "../registry-bridge.js";
import { TokenStore, type Encryptor } from "../token-store.js";
import { SettingsStore } from "../settings-store.js";

class PlainEncryptor implements Encryptor {
  available() { return true; }
  encrypt(p: string) { return Buffer.from(p, "utf8"); }
  decrypt(c: Buffer) { return c.toString("utf8"); }
}
const freshDir = () => mkdtempSync(join(tmpdir(), "todl-bridge-"));

/** A structural stand-in for PackageManager with per-method overrides. */
class FakeManager implements PackageManagerLike {
  constructor(private readonly over: Partial<PackageManagerLike> = {}) {}
  list() { return this.over.list?.() ?? Promise.resolve([] as string[]); }
  versions(n: string) { return this.over.versions?.(n) ?? Promise.resolve({ versions: ["0.1.0"], distTags: { latest: "0.1.0" } }); }
  manifestKind(n: string) { return this.over.manifestKind?.(n) ?? Promise.resolve(""); }
  getContent(ref: any) { return this.over.getContent?.(ref) ?? Promise.resolve(new Uint8Array()); }
  getPackage(ref: any) { return this.over.getPackage?.(ref) ?? Promise.reject(new Error("no")); }
  getSources(ref: any) { return this.over.getSources?.(ref) ?? Promise.resolve([]); }
  resolveClosure(deps: readonly string[]) { return this.over.resolveClosure?.(deps) ?? Promise.resolve({ metaModels: [], libraries: [], order: [] }); }
  publish(dir: string) { return this.over.publish?.(dir) ?? Promise.resolve(); }
}

function makeBridge(
  over: Partial<PackageManagerLike> = {},
  env: Record<string, string | undefined> = {},
  onConfig?: (config: any) => void,
  compile?: (directory: string, options?: { scope?: string; outDir?: string }) => Promise<any>,
) {
  const dir = freshDir();
  return new RegistryBridge({
    tokenStore: new TokenStore(dir, new PlainEncryptor()),
    settingsStore: new SettingsStore(dir),
    createManager: (config) => { onConfig?.(config); return new FakeManager(over); },
    createCompiler: () => ({
      compile: compile ?? (() => Promise.resolve({ ok: true, diagnostics: [], errors: [] } as any)),
    }),
    env,
  });
}

test("list delegates to the manager", async () => {
  const bridge = makeBridge({ list: () => Promise.resolve(["aws", "microsoft"]) });
  assert.deepEqual((await bridge.list()).sort(), ["aws", "microsoft"]);
});

test("compileDir compiles under <dir>/dist and returns a serializable view", async () => {
  const bridge = makeBridge({}, {}, undefined, (directory, options) =>
    Promise.resolve({
      ok: true,
      diagnostics: [{ severity: "warning", message: "heads up" }],
      errors: [],
      files: ["package.json", "model.json"],
      package: { id: "demo", name: "@scope/demo", version: "0.1.0", sources: [{ uri: "a.todl", text: "" }] },
      _outDir: options?.outDir,
      _dir: directory,
    } as any),
  );
  const view = await bridge.compileDir("C:/proj/demo");
  assert.equal(view.ok, true);
  assert.equal(view.outDir, join("C:/proj/demo", "dist"));
  assert.deepEqual(view.files, ["package.json", "model.json"]);
  assert.equal(view.name, "@scope/demo");
  assert.equal(view.version, "0.1.0");
  assert.equal(view.sourceCount, 1);
  assert.deepEqual(view.diagnostics, [{ severity: "warning", message: "heads up" }]);
});

test("getMeta returns the package kind via manifestKind", async () => {
  const bridge = makeBridge({ manifestKind: () => Promise.resolve("library") });
  assert.equal(await bridge.getMeta("aws"), "library");
});

test("getPackage / getSources / resolveClosure / publishDir delegate to the manager", async () => {
  const bridge = makeBridge({
    getPackage: () => Promise.resolve({ name: "@pragmatic-tech-ai/aws", meta: { kind: "library", id: "aws" }, dependencies: [], document: { nodes: [] } } as any),
    getSources: () => Promise.resolve([{ name: "aws.todl", text: "concept EC2;\n" }]),
    resolveClosure: (deps) => Promise.resolve({ metaModels: [], libraries: [], order: [...deps] }),
    publish: () => Promise.resolve(),
  });
  assert.equal((await bridge.getPackage({ name: "@pragmatic-tech-ai/aws" })).name, "@pragmatic-tech-ai/aws");
  assert.deepEqual(await bridge.getSources({ name: "@pragmatic-tech-ai/aws" }), [{ name: "aws.todl", text: "concept EC2;\n" }]);
  assert.deepEqual((await bridge.resolveClosure(["@pragmatic-tech-ai/aws"])).order, ["@pragmatic-tech-ai/aws"]);
  await bridge.publishDir("/dist"); // resolves without throwing
});

test("getConfig reports settings + hasToken, never the token itself", async () => {
  const bridge = makeBridge();
  let cfg = await bridge.getConfig();
  assert.equal(cfg.hasToken, false);
  assert.equal(cfg.scope, "@pragmatic-tech-ai");
  assert.ok(!("token" in cfg));
  await bridge.setStoredToken("ghp_x");
  cfg = await bridge.getConfig();
  assert.equal(cfg.hasToken, true);
});

test("env-var token: hasToken reflects process.env and never the value", async () => {
  const bridge = makeBridge({}, { GH_PAT: "ghp_fromenv" });
  await bridge.useEnvToken("GH_PAT");
  const cfg = await bridge.getConfig();
  assert.equal(cfg.tokenSource, "env");
  assert.equal(cfg.tokenEnvVar, "GH_PAT");
  assert.equal(cfg.hasToken, true);
  assert.ok(!("token" in cfg));
  await bridge.useEnvToken("NOPE");
  assert.equal((await bridge.getConfig()).hasToken, false);
});

test("listEnvVars returns sorted defined env keys", async () => {
  const bridge = makeBridge({}, { B: "1", A: "2", C: undefined });
  assert.deepEqual(await bridge.listEnvVars(), ["A", "B"]);
});

test("setSettings is reflected in the config handed to createManager", async () => {
  let seenConfig: any;
  const bridge = makeBridge({}, {}, (config) => { seenConfig = config; });
  await bridge.setSettings({ org: "acme" });
  await bridge.list();
  assert.equal(seenConfig.org, "acme");
});
