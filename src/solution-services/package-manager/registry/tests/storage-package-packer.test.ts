import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { FakeStorage } from "@pragmatic-tech-ai/todl-runtime";
import { TarReader } from "../tar-reader.js";
import { StoragePackagePacker } from "../storage-package-packer.js";

class PackerFixtures
{
    public static async SandboxLayout(): Promise<FakeStorage>
    {
        const sandbox = new FakeStorage();
        await sandbox.WriteText("package.json", JSON.stringify({ name: "demo-lib", version: "1.0.0" }));
        await sandbox.WriteText("model.json", JSON.stringify({ nodes: [], edges: [] }));
        await sandbox.WriteText("src/model.todl", "namespace acme {}");
        return sandbox;
    }
}

describe("StoragePackagePacker", () =>
{
    test("packs an in-memory IStorage layout under package/ (node:zlib round-trip) and parses the manifest", async () =>
    {
        const sandbox = await PackerFixtures.SandboxLayout();

        const pkg = await StoragePackagePacker.Pack(sandbox);

        assert.deepEqual(pkg.Manifest, { name: "demo-lib", version: "1.0.0" });
        const byPath = new Map(TarReader.read(pkg.Tarball).map((f) => [f.path, f.bytes] as const));
        const dec = new TextDecoder();
        assert.equal(dec.decode(byPath.get("package/package.json")), await sandbox.ReadText("package.json"));
        assert.equal(dec.decode(byPath.get("package/model.json")), await sandbox.ReadText("model.json"));
        assert.equal(dec.decode(byPath.get("package/src/model.todl")), await sandbox.ReadText("src/model.todl"));
    });

    test("throws when the layout has no top-level package.json", async () =>
    {
        const sandbox = new FakeStorage();
        await sandbox.WriteText("model.json", "{}");

        await assert.rejects(() => StoragePackagePacker.Pack(sandbox), /no package\.json/);
    });
});
