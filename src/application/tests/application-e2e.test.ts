import { test } from "node:test";
import assert from "node:assert/strict";
import { ApplicationBootstrapper } from "../application-bootstrapper.js";
import { AppRegistry, DemoApp } from "../../codegen/tests/fixtures/demo-app.package.generated.js";

// The full chain: a compiled app was generated into demo-app.package.generated.ts
// (Wave 3a); boot it headlessly and read model-scoped instances back.
test("a generated application package boots headlessly and reads model-scoped data", async () =>
{
    const entry = await ApplicationBootstrapper.BootRegistry(AppRegistry.Create());

    // Root (model "core") sees only its own instance...
    assert.deepEqual((entry.Root() as DemoApp).services.map((s) => s.name), ["API"]);
    // ...and a sibling model ("ops") is scoped to its own.
    const ops = entry.Registry().GetRequired("ops") as DemoApp;
    assert.deepEqual(ops.services.map((s) => s.name), ["Worker"]);
});
