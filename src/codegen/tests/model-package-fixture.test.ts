import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { check } from "../../compiler-services/api.js";
import { ServiceProvider } from "@pragmatic-tech-ai/todl-runtime";
import { ModelPackageGenerator } from "../model-package.js";
import { AppRegistry, DemoApp } from "./fixtures/demo-app.package.generated.js";

const TWO_MODEL = `
namespace a {
  concept service { name : string; }
  model core : a {
    annotate entrypoint { }
    service api { name = "API"; }
  }
  model ops : a {
    service worker { name = "Worker"; }
  }
}
`;

test("generateModelPackage reproduces the golden fixture byte-for-byte", () =>
{
  const golden = readFileSync(
    fileURLToPath(new URL("./fixtures/demo-app.package.generated.ts", import.meta.url)),
    "utf8",
  );
  const { model } = check([{ uri: "app.todl", text: TWO_MODEL }]);
  const out = ModelPackageGenerator.Generate(model, { name: "demo-app", importSpecifier: "../../../index.js" });
  assert.equal(out, golden);
});

test("the generated registry factory wires models, root, and model-scoped data", async () =>
{
  const registry = AppRegistry.Create();
  assert.deepEqual([...registry.Models()].sort(), ["core", "ops"]);
  assert.equal(registry.RootModel(), "core");

  await registry.PrepareAll(new ServiceProvider());

  const root = registry.Root() as DemoApp;
  assert.deepEqual(root.services.map((s) => s.name), ["API"]);          // root sees only its own instance
  const ops = registry.GetRequired("ops") as DemoApp;
  assert.deepEqual(ops.services.map((s) => s.name), ["Worker"]);        // sibling model is scoped to its own
});
