import { test } from "node:test";
import assert from "node:assert/strict";
import { IpcPackageSource } from "../ipc-package-source.js";
import type { RegistryClient } from "../../../services/registry/registry-client.js";

test("resolve/versions delegate to the RegistryClient", async () => {
  const calls: string[] = [];
  const client = {
    resolvePackage: async (ref: { model: string; version?: string }) => {
      calls.push(`resolve:${ref.model}`);
      return { ref: { model: ref.model, version: "1.0.0" }, manifest: new Uint8Array(), dependencies: [] };
    },
    packageVersions: async (model: string) => {
      calls.push(`versions:${model}`);
      return ["1.0.0"];
    },
  } as unknown as RegistryClient;

  const src = new IpcPackageSource(client);
  const resolved = await src.resolve({ model: "acme.a", version: "1.0.0" });
  assert.equal(resolved.ref.model, "acme.a");
  assert.deepEqual(await src.versions("acme.a"), ["1.0.0"]);
  assert.deepEqual(calls, ["resolve:acme.a", "versions:acme.a"]);
});
