import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { FakeStorage } from "@pragmatic-tech-ai/todl-runtime";
import { WritePolicyWriter } from "../write-policy-writer.js";
import { WritePolicy } from "../project-content-generator.js";

describe("WritePolicyWriter.Write", () =>
{
    test("Overwrite replaces existing content", async () =>
    {
        const storage = new FakeStorage();
        await storage.WriteText("f.ts", "old");

        const wrote = await WritePolicyWriter.Write(storage, "f.ts", "new", WritePolicy.Overwrite);

        assert.equal(wrote, true);
        assert.equal(await storage.ReadText("f.ts"), "new");
    });

    test("WriteOnce skips when the file exists", async () =>
    {
        const storage = new FakeStorage();
        await storage.WriteText("f.mu", "user");

        const wrote = await WritePolicyWriter.Write(storage, "f.mu", "gen", WritePolicy.WriteOnce);

        assert.equal(wrote, false);
        assert.equal(await storage.ReadText("f.mu"), "user");
    });

    test("PreserveHandEdits skips when the marker is gone", async () =>
    {
        const storage = new FakeStorage();
        await storage.WriteText("f.mu", "// hand-edited\n...");

        const wrote = await WritePolicyWriter.Write(
            storage, "f.mu", "gen", WritePolicy.PreserveHandEdits, "// GENERATED");

        assert.equal(wrote, false);
    });

    test("PreserveHandEdits writes when first line is the marker", async () =>
    {
        const storage = new FakeStorage();
        await storage.WriteText("f.mu", "// GENERATED\n...");

        const wrote = await WritePolicyWriter.Write(
            storage, "f.mu", "gen", WritePolicy.PreserveHandEdits, "// GENERATED");

        assert.equal(wrote, true);
        assert.equal(await storage.ReadText("f.mu"), "gen");
    });
});
