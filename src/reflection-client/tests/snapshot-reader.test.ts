import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { GraphQuery } from "../../graph-api/graph-query-engine.js";
import { Snapshot } from "../../graph-api/index.js";
import { FrozenGraph } from "../../domain/graph.js";
import { Manifest } from "../../manifest/reflection/reflection.js";
import { ManifestWriter } from "../../manifest/manifest-writer.js";
import type { LogicalManifest } from "../../manifest/logical.js";
import { MirrorReader } from "../reflected-entity.js";
import { SnapshotReader } from "../snapshot-reader.js";

class SnapshotFixture
{
    public static Build()
    {
        const logical: LogicalManifest = {
            format: "todl-manifest/1", model: "svc", version: "1.0.0", root: "Element",
            concepts: {
                Element: { extends: null, fields: {}, relationships: {}, invariants: [], annotations: [] },
                Service: {
                    extends: "Element",
                    fields: { name: { type: "string", card: "?" } },
                    relationships: { calls: { targets: ["Service"], card: "*", annotations: [] } },
                    invariants: [], annotations: [],
                },
            },
            classes: {}, taxonomies: {},
        };
        const g = new FrozenGraph();
        const m = Manifest.load(ManifestWriter.fromLogical(logical).toJSON());
        g.PreRegister(m);
        g.Finalize(m);
        g.BindSeed(
            { nodes: [{ id: "a", type: "Service", attrs: { name: "checkout" } }, { id: "b", type: "Service", attrs: {} }], edges: [{ from: "a", rel: "calls", to: "b" }] },
            { model: "svc", version: "1.0.0" },
        );
        const mirror = new GraphQuery(g).Reflect("a")!;
        return { mirror, snapshot: Snapshot.of(mirror) };
    }
}

describe("SnapshotReader", () =>
{
    test("reads id, concept, fields, and targets from a MirrorSnapshot", () =>
    {
        const { snapshot } = SnapshotFixture.Build();
        const reader = new SnapshotReader(snapshot);
        assert.equal(reader.id, "a");
        assert.equal(reader.concept, "Service");
        assert.equal(reader.field("name"), "checkout");
        assert.deepEqual([...reader.targets("calls")], ["b"]);
        assert.ok(reader.fieldNames().includes("name"));
    });

    test("parity with MirrorReader for the same instance", () =>
    {
        const { mirror, snapshot } = SnapshotFixture.Build();
        const local = new MirrorReader(mirror);
        const remote = new SnapshotReader(snapshot);
        assert.equal(local.id, remote.id);
        assert.equal(local.concept, remote.concept);
        assert.equal(local.field("name"), remote.field("name"));
        assert.deepEqual([...local.targets("calls")], [...remote.targets("calls")]);
    });
});
