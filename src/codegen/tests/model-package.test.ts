import { test } from "node:test";
import assert from "node:assert/strict";
import { check } from "../../compiler-services/api.js";
import { ModelPackageGenerator } from "../model-package.js";

// Two models sharing one ontology; `core` is the explicit application root.
// Syntax mirrors model-annotation.test.ts: `annotate entrypoint { }` inside model block.
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

// Single model + package-level app-ness (no explicit model mark). The Wave 2
// compiler marks the sole model implicitly ONLY when app-ness is declared
// (application-root-pass.ts:22 treats marked=0 + no package-app as a library).
// Syntax mirrors application-annotation.test.ts: `package { annotate entrypoint { } }`.
const SINGLE_MODEL = `
namespace a {
  concept service { name : string; }
  model solo : a {
    service api { name = "API"; }
  }
  package { annotate entrypoint { } }
}
`;

const LIBRARY = `
namespace a {
  concept service { name : string; }
}
`;

function repoFrom(text: string)
{
    const { model } = check([{ uri: "app.todl", text }]);
    return model;
}

test("Generate emits one accessor class, a shard per model, registers each, and bakes the explicit root", () =>
{
    const out = ModelPackageGenerator.Generate(repoFrom(TWO_MODEL), { name: "demo-app", importSpecifier: "../../../index.js" });
    assert.match(out, /export class DemoApp extends ModelDataSource/);
    assert.match(out, /const SHARD_CORE: TodlDocument =/);
    assert.match(out, /const SHARD_OPS: TodlDocument =/);
    assert.match(out, /registry\.Register\("core", new DemoApp\(new BundledModelDataConnector\(SHARD_CORE\)\)\)/);
    assert.match(out, /registry\.Register\("ops", new DemoApp\(new BundledModelDataConnector\(SHARD_OPS\)\)\)/);
    assert.match(out, /registry\.SetRoot\("core"\)/);
    assert.match(out, /export class AppRegistry/);
    // one merged header, no duplicate ModelDataSource import from the read-client body
    assert.equal(out.match(/import \{ ModelDataSource/g)?.length, 1);
});

test("Generate bakes the implicit sole-model root (package declares app-ness)", () =>
{
    const out = ModelPackageGenerator.Generate(repoFrom(SINGLE_MODEL), { name: "solo-app" });
    assert.match(out, /registry\.SetRoot\("solo"\)/);
});

test("Generate throws when there is no application root", () =>
{
    assert.throws(
        () => ModelPackageGenerator.Generate(repoFrom(LIBRARY), { name: "lib" }),
        /application root/i,
    );
});

test("registryClassName option renames the factory", () =>
{
    const out = ModelPackageGenerator.Generate(repoFrom(TWO_MODEL), { name: "demo-app", registryClassName: "DemoRegistry" });
    assert.match(out, /export class DemoRegistry/);
});
