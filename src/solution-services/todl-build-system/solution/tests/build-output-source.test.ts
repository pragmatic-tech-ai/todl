import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { BuildOutputSource } from "../build-output-source.js";
import { PackageKind, type PackageRef } from "../../../../publish/publish.js";

function ref(id: string, version = "1.0.0"): PackageRef
{
    return { kind: PackageKind.Library, id, version };
}

describe("BuildOutputSource", () =>
{
    test("returns undefined before anything is added", async () =>
    {
        assert.equal(await new BuildOutputSource().TryGet(ref("x")), undefined);
    });

    test("TryGet returns an added package by id + version", async () =>
    {
        const source = new BuildOutputSource();
        const pkg = { Document: { nodes: [], edges: [] }, Dependencies: [] };
        source.Add("shop", "1.0.0", pkg);
        assert.equal(await source.TryGet(ref("shop", "1.0.0")), pkg);
        assert.equal(await source.TryGet(ref("shop", "2.0.0")), undefined);
    });
});
