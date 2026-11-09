import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ManifestWriter } from "../manifest-writer.js";
import { ManifestReader } from "../manifest-reader.js";
import { ManifestValidator } from "../manifest-validator.js";
import { Manifest } from "../reflection/reflection.js";
import type { LogicalManifest } from "../logical.js";
import type { ManifestJson } from "../records.js";
import { compilePackage } from "../../publish/publish.js";
import { PackageManifestBridge } from "../../solution-services/package-manager/package-manifest-bridge.js";

class PrimitiveFixtures
{
    public static readonly Model = "shop.p";
    public static readonly Version = "1.0.0";
    public static readonly Source = "namespace shop { primitive sku : string { } primitive sku2 : sku { } primitive count : integer { } "
        + "primitive opaque { } concept W { a : sku2?; n : count?; o : opaque?; s : string?; } }";

    public static Logical(): LogicalManifest
    {
        const out = compilePackage([], [{ uri: "shop.todl", text: PrimitiveFixtures.Source }], { id: PrimitiveFixtures.Model, version: PrimitiveFixtures.Version });
        assert.ok(out.ok, JSON.stringify(out.errors));
        const repo = PackageManifestBridge.repositoryOf(out.package!.fullDocument);
        return PackageManifestBridge.toLogical(repo, PrimitiveFixtures.Model, PrimitiveFixtures.Version);
    }

    /** The baseType chain of a field's type, as full names. */
    public static Chain(m: Manifest, field: string): string[]
    {
        const chain: string[] = [];
        let type = m.getType("shop.W")!.getField(field)!.fieldType;
        while (type !== undefined)
        {
            chain.push(type.fullName);
            type = type.baseType;
        }
        return chain;
    }
}

describe("primitive bases in the manifest", () =>
{
    test("the emitter records each reached primitive's qualified base", () =>
    {
        assert.deepEqual(PrimitiveFixtures.Logical().primitives, {
            "shop.sku2": "shop.sku",
            "shop.count": "integer",
            "shop.opaque": null,
            "shop.sku": "string",
        });
    });

    test("a model without user primitives emits no primitives key", () =>
    {
        const out = compilePackage([], [{ uri: "a.todl", text: "namespace a { concept W { s : string?; } }" }], { id: "a", version: "1.0.0" });
        assert.ok(out.ok);
        const logical = PackageManifestBridge.toLogical(PackageManifestBridge.repositoryOf(out.package!.fullDocument), "a", "1.0.0");
        assert.equal("primitives" in logical, false);
    });

    test("baseType walks the alias chain in binary and JSON", () =>
    {
        const writer = ManifestWriter.fromLogical(PrimitiveFixtures.Logical());
        const json = JSON.parse(JSON.stringify(writer.toJSON())) as ManifestJson;
        for (const m of [Manifest.load(writer.toBinary()), Manifest.load(json)])
        {
            assert.deepEqual(PrimitiveFixtures.Chain(m, "a"), ["shop.sku2", "shop.sku", "string"]);
            assert.deepEqual(PrimitiveFixtures.Chain(m, "n"), ["shop.count", "integer"]);
            assert.deepEqual(PrimitiveFixtures.Chain(m, "o"), ["shop.opaque"]);
            assert.deepEqual(PrimitiveFixtures.Chain(m, "s"), ["string"]);
        }
        assert.equal(new ManifestValidator(ManifestReader.fromBinary(writer.toBinary())).isValid, true);
    });

    test("an undefined primitive base is a reference error", () =>
    {
        const out = compilePackage([], [{ uri: "a.todl", text: "namespace a { primitive bad : nope { } }" }], { id: "a", version: "1.0.0" });
        assert.equal(out.ok, false);
        assert.ok(out.errors.some((e) => e.message.includes("\"nope\"")), JSON.stringify(out.errors));
    });

    test("a logical manifest without primitives lowers with base-less primitive rows", () =>
    {
        const logical = PrimitiveFixtures.Logical();
        delete logical.primitives;
        const m = Manifest.load(ManifestWriter.fromLogical(logical).toBinary());
        assert.deepEqual(PrimitiveFixtures.Chain(m, "a"), ["shop.sku2"]);
    });
});
