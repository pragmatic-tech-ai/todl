import { test } from "node:test";
import assert from "node:assert/strict";
import { CanonicalTypeScriptOptions } from "../compiler-options.js";

test("canonical options target es2020 with bundler resolution and no emit", () =>
{
    assert.equal(CanonicalTypeScriptOptions.Target, "ES2020");
    assert.equal(CanonicalTypeScriptOptions.Module, "ESNext");
    assert.equal(CanonicalTypeScriptOptions.ModuleResolution, "Bundler");
    assert.equal(CanonicalTypeScriptOptions.Strict, true);
    assert.equal(CanonicalTypeScriptOptions.NoEmit, true);
    assert.equal(CanonicalTypeScriptOptions.SkipLibCheck, true);
    assert.deepEqual([...CanonicalTypeScriptOptions.Lib], ["ES2020", "DOM", "DOM.Iterable"]);
});

test("canonical options are frozen", () =>
{
    assert.throws(() => { (CanonicalTypeScriptOptions as { Strict: boolean }).Strict = false; });
});
