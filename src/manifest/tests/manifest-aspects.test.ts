import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ManifestWriter } from "../manifest-writer.js";
import { ManifestReader } from "../manifest-reader.js";
import { ManifestValidator } from "../manifest-validator.js";
import { Manifest } from "../reflection/reflection.js";
import { MetaKind } from "../enums.js";
import type { LogicalManifest, ConceptDef, AspectDef } from "../logical.js";
import type { ManifestJson } from "../records.js";
import { MetadataSnapshot } from "../../domain/metadata-snapshot.js";
import { GraphQuery } from "../../graph-api/graph-query-engine.js";
import { ReflectionSummary } from "./reflection-summary.js";

class AspectFixtures
{
    public static Concept(extendsId: string | null, aspects: string[] = []): ConceptDef
    {
        return { extends: extendsId, fields: {}, relationships: {}, invariants: [], annotations: [], aspects };
    }

    public static Aspect(aspects: string[] = []): AspectDef
    {
        return { fields: {}, relationships: {}, invariants: [], annotations: [], aspects };
    }

    /** Asset { tag }, Tracked : Asset, Server : Tracked, RackServer : Server, Laptop : Asset, Person. */
    public static Logical(): LogicalManifest
    {
        const asset = AspectFixtures.Aspect();
        asset.fields = { tag: { type: "string", card: "1" } };
        return {
            format: "todl-manifest/1", model: "fleet", version: "1.0.0", root: "Element",
            concepts: {
                Element: AspectFixtures.Concept(null),
                Server: AspectFixtures.Concept("Element", ["Tracked"]),
                RackServer: AspectFixtures.Concept("Server"),
                Laptop: AspectFixtures.Concept("Element", ["Asset"]),
                Person: AspectFixtures.Concept("Element"),
            },
            aspects: { Asset: asset, Tracked: AspectFixtures.Aspect(["Asset"]) },
            classes: {}, taxonomies: {},
        };
    }

    public static Names(types: { fullName: string }[]): string[]
    {
        return types.map((t) => t.fullName);
    }

    public static Fixture(name: string): Buffer
    {
        return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)));
    }
}

describe("aspects in the manifest", () =>
{
    test("aspect round-trips binary and JSON", () =>
    {
        const writer = ManifestWriter.fromLogical(AspectFixtures.Logical());
        const json = JSON.parse(JSON.stringify(writer.toJSON())) as ManifestJson;
        for (const m of [Manifest.load(writer.toBinary()), Manifest.load(json)])
        {
            const asset = m.getType("Asset")!;
            assert.equal(asset.isAspect, true);
            assert.equal(asset.kind, MetaKind.Aspect);
            assert.equal(m.getType("Server")!.isAspect, false);
            assert.deepEqual(AspectFixtures.Names(m.getType("Server")!.getAspects()), ["Tracked", "Asset"]);
            assert.deepEqual(AspectFixtures.Names(m.getType("Tracked")!.getAspects()), ["Asset"]);
            assert.deepEqual(AspectFixtures.Names(m.getType("Laptop")!.getAspects()), ["Asset"]);
            assert.deepEqual(m.getType("Person")!.getAspects(), []);
        }
        const reader = ManifestReader.fromBinary(ManifestWriter.fromLogical(AspectFixtures.Logical()).toBinary());
        assert.equal(new ManifestValidator(reader).isValid, true);
    });

    test("an aspect inclusion cycle terminates, each aspect is carried once and never carries itself", () =>
    {
        const logical = AspectFixtures.Logical();
        logical.aspects!.Asset!.aspects = ["Tracked"];
        const m = Manifest.load(ManifestWriter.fromLogical(logical).toBinary());
        assert.deepEqual(AspectFixtures.Names(m.getType("Server")!.getAspects()), ["Tracked", "Asset"]);
        assert.deepEqual(AspectFixtures.Names(m.getType("Asset")!.getAspects()), ["Tracked"]);
        assert.deepEqual(AspectFixtures.Names(m.getType("Tracked")!.getAspects()), ["Asset"]);
        assert.equal(m.getType("Asset")!.isAssignableFrom(m.getType("Laptop")!), true);
    });

    test("subtype inherits its supertype's aspects", () =>
    {
        const m = Manifest.load(ManifestWriter.fromLogical(AspectFixtures.Logical()).toBinary());
        assert.deepEqual(AspectFixtures.Names(m.getType("RackServer")!.getAspects()), ["Tracked", "Asset"]);
    });

    test("carrier gets aspect members", () =>
    {
        const m = Manifest.load(ManifestWriter.fromLogical(AspectFixtures.Logical()).toBinary());
        for (const name of ["Server", "RackServer", "Laptop"])
        {
            const type = m.getType(name)!;
            const tag = type.getFields().find((f) => f.name === "tag");
            assert.ok(tag, `${name} carries tag`);
            assert.equal(tag.declaringType.fullName, "Asset");
            assert.equal(tag.reflectedType.fullName, name);
            assert.ok(type.getMembers().some((x) => x.name === "tag"));
        }
        assert.equal(m.getType("Person")!.getFields().some((f) => f.name === "tag"), false);
    });

    test("an aspect is assignable from its carriers only", () =>
    {
        const m = Manifest.load(ManifestWriter.fromLogical(AspectFixtures.Logical()).toBinary());
        const asset = m.getType("Asset")!;
        assert.equal(asset.isAssignableFrom(m.getType("RackServer")!), true);
        assert.equal(asset.isAssignableFrom(m.getType("Tracked")!), true);
        assert.equal(asset.isAssignableFrom(m.getType("Person")!), false);
        assert.equal(m.getType("Server")!.isAssignableFrom(m.getType("Asset")!), false);
    });

    test("InstancesOf aspect returns carriers", () =>
    {
        const g = new MetadataSnapshot();
        const m = Manifest.load(ManifestWriter.fromLogical(AspectFixtures.Logical()).toBinary());
        g.PreRegister(m);
        g.Finalize(m);
        g.BindSeed({
            nodes: [
                { id: "s", type: "Server", attrs: { tag: "a" } },
                { id: "r", type: "RackServer", attrs: { tag: "b" } },
                { id: "l", type: "Laptop", attrs: { tag: "c" } },
                { id: "p", type: "Person", attrs: {} },
            ],
            edges: [],
        }, { model: "fleet", version: "1.0.0" });
        const ids = new GraphQuery(g).InstancesOf("Asset").map((x) => x.node.id).sort();
        assert.deepEqual(ids, ["l", "r", "s"]);
    });

    test("old manifest loads without aspects", () =>
    {
        const expected = JSON.parse(AspectFixtures.Fixture("legacy-reflection.json").toString("utf8"));
        const fromBinary = Manifest.load(new Uint8Array(AspectFixtures.Fixture("legacy-manifest.bin")));
        const fromJson = Manifest.load(JSON.parse(AspectFixtures.Fixture("legacy-manifest.json").toString("utf8")) as ManifestJson);
        assert.deepEqual(JSON.parse(JSON.stringify(ReflectionSummary.Of(fromBinary))), expected);
        assert.deepEqual(JSON.parse(JSON.stringify(ReflectionSummary.Of(fromJson))), expected);
        for (const t of fromBinary.types())
        {
            assert.equal(t.isAspect, false);
            assert.deepEqual(t.getAspects(), []);
        }
    });

    test("an old logical manifest without aspects still lowers", () =>
    {
        const old = JSON.parse(AspectFixtures.Fixture("legacy-manifest.logical.json").toString("utf8")) as LogicalManifest;
        const m = Manifest.load(ManifestWriter.fromLogical(old).toBinary());
        const expected = JSON.parse(AspectFixtures.Fixture("legacy-reflection.json").toString("utf8"));
        assert.deepEqual(JSON.parse(JSON.stringify(ReflectionSummary.Of(m))), expected);
    });
});
