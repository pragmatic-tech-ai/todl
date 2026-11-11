import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { IEdgeConcept } from "../index.js";

class SecurityBarrel
{
    public static readonly Names: readonly string[] = [
        "SecurityAction", "SecurityDepth", "BaseRoleName", "FieldProfileRight", "SecurityTerms", "SecurityNames",
        "PackageSecurity", "PackageSecurityCompiler", "ReifiedOperators",
    ];
}

describe("security barrel exports", () =>
{
    it("exposes the package security surface from the package root", async () =>
    {
        const keys = Object.keys(await import("../index.js"));
        for (const name of SecurityBarrel.Names)
        {
            assert.ok(keys.includes(name), name);
        }
    });

    it("resolves the type-only exports", () =>
    {
        const types: [IEdgeConcept?] = [];
        assert.equal(types.length, 0);
    });
});
