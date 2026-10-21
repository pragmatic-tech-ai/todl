import { test } from "node:test";
import assert from "node:assert/strict";
import { BundlerKey, type IBundler, type BundleAppResult } from "../bundler.js";
import { ServiceProvider } from "@pragmatic-tech-ai/todl-runtime";

test("BundlerKey resolves a bound IBundler", async () =>
{
    const stub: IBundler =
    {
        BundleApp: async () => ({ Text: "ok", Diagnostics: [] } satisfies BundleAppResult),
    };
    const p = new ServiceProvider();
    p.registerInstance(BundlerKey, stub);
    const got = p.getRequired(BundlerKey);
    assert.equal((await got.BundleApp({ Entry: "e", Files: [] })).Text, "ok");
});
