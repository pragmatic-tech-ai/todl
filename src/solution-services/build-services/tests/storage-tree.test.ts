import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { FakeStorage } from "@pragmatic-tech-ai/todl-runtime";
import { StorageTree } from "../storage-tree.js";

describe("StorageTree", () =>
{
    test("CopyAll copies root and nested files into the target", async () =>
    {
        const from = new FakeStorage();
        await from.WriteText("package.json", "{}");
        await from.WriteText("dist/index.js", "export {}");
        const to = new FakeStorage();

        await StorageTree.CopyAll(from, to);

        assert.equal(await to.ReadText("package.json"), "{}");
        assert.equal(await to.ReadText("dist/index.js"), "export {}");
    });

    test("Files lists every file path, sorted, excluding directories", async () =>
    {
        const storage = new FakeStorage();
        await storage.WriteText("model.json", "{}");
        await storage.WriteText("assets/icon.svg", "<svg/>");

        const files = await StorageTree.Files(storage);

        assert.deepEqual(files, ["assets/icon.svg", "model.json"]);
    });
});
