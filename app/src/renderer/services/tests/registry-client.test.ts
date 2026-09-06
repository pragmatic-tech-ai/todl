import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { RegistryClient } from "../registry-client.js";

const calls: Array<[string, unknown[]]> = [];
function stubWindow(overrides: Record<string, (...a: any[]) => any> = {}) {
  const record = (name: string) => (...args: any[]) => {
    calls.push([name, args]);
    return overrides[name]?.(...args) ?? Promise.resolve(undefined);
  };
  (globalThis as any).window = {
    todl: {
      registry: { list: record("list"), versions: record("versions"), getContent: record("getContent"), getPackage: record("getPackage"), getMeta: record("getMeta"), resolveClosure: record("resolveClosure"), publishDir: record("publishDir"), getSources: record("getSources") },
      config: { get: record("get"), setToken: record("setToken"), useEnvToken: record("useEnvToken"), listEnvVars: record("listEnvVars"), setSettings: record("setSettings") },
      dialog: { pickDirectory: record("pickDirectory") },
    },
  };
}
afterEach(() => {
  calls.length = 0;
  delete (globalThis as any).window;
});

test("list forwards to window.todl.registry.list and returns its result", async () => {
  stubWindow({ list: () => Promise.resolve(["aws"]) });
  assert.deepEqual(await new RegistryClient().list(), ["aws"]);
  assert.deepEqual(calls[0], ["list", []]);
});

test("versions/getPackage/resolveClosure forward their arguments", async () => {
  stubWindow();
  const client = new RegistryClient();
  await client.versions("microsoft");
  await client.getPackage({ name: "aws" });
  await client.resolveClosure(["@pragmatic-tech-ai/aws"]);
  await client.getSources({ name: "aws" });
  assert.deepEqual(calls.map((c) => c[0]), ["versions", "getPackage", "resolveClosure", "getSources"]);
  assert.deepEqual(calls[0]![1], ["microsoft"]);
  assert.deepEqual(calls[1]![1], [{ name: "aws" }]);
  assert.deepEqual(calls[2]![1], [["@pragmatic-tech-ai/aws"]]);
  assert.deepEqual(calls[3]![1], [{ name: "aws" }]);
});

test("getConfig / setToken / setSettings forward to the config namespace", async () => {
  stubWindow({ get: () => Promise.resolve({ registry: "r", scope: "@s", org: "o", hasToken: true }) });
  const client = new RegistryClient();
  assert.deepEqual(await client.getConfig(), { registry: "r", scope: "@s", org: "o", hasToken: true });
  await client.setStoredToken("ghp_x");
  await client.setSettings({ org: "acme" });
  assert.deepEqual(calls.map((c) => c[0]), ["get", "setToken", "setSettings"]);
  assert.deepEqual(calls[1]![1], ["ghp_x"]);
});
