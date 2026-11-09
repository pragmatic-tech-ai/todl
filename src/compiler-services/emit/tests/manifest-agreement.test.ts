import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { Repository } from "../../model/model.js";
import { MetaKind } from "../../model/kinds.js";
import { EngineFixture } from "../../../engine-bridge/tests/EngineFixture.js";
import { GraphQuery } from "../../../graph-api/graph-query-engine.js";

/** Compares the manifest-side view of fixtures with the repository. */
class AgreementHarness
{
    /** Asserts manifest and repository agree; returns the number of (type, target) pairs compared. */
    public static Check(repo: Repository, label: string): number
    {
        const frozen = EngineFixture.Graph(repo);
        const query = new GraphQuery(frozen);
        const manifest = frozen.manifests[0]!;
        const types = [...repo.nodesOfMetaKind(MetaKind.Concept), ...repo.nodesOfMetaKind(MetaKind.Aspect)];
        let pairs = 0;
        for (const typeId of types)
        {
            const type = manifest.getType(typeId);
            assert.ok(type, `${label}: ${typeId} is in the manifest`);
            assert.deepEqual(
                type.getAspects().map((a) => a.fullName),
                repo.AspectsOf(typeId),
                `${label}: aspects of ${typeId}`,
            );
            const schema = repo.effectiveSchema(typeId);
            assert.deepEqual(
                type.getFields().map((f) => [f.name, f.declaringType.fullName, f.cardinality, f.fieldType?.fullName]),
                schema.fields.map((f) => [f.name, f.declaredBy, f.cardinality, f.type]),
                `${label}: fields of ${typeId}`,
            );
            assert.deepEqual(
                type.getRelationships().map((r) => [r.name, r.declaringType.fullName]),
                schema.relationships.map((r) => [r.name, r.declaredBy]),
                `${label}: relationships of ${typeId}`,
            );
            for (const otherId of types)
            {
                assert.equal(
                    manifest.getType(otherId)!.isAssignableFrom(type),
                    repo.IsA(typeId, otherId),
                    `${label}: ${otherId} isAssignableFrom ${typeId}`,
                );
                pairs++;
            }
        }
        for (const id of types)
        {
            const fromQuery = query.InstancesOf(id).map((m) => m.node.id).sort();
            // Terms are class nodes: the manifest carries them in its class table, not the data graph.
            const fromRepo = repo.InstancesMatching(id).filter((n) => !repo.isClass(n.id)).map((n) => n.id).sort();
            assert.deepEqual(fromQuery, fromRepo, `${label}: instances of ${id}`);
        }
        return pairs;
    }
}

describe("manifest agrees with repository", () =>
{
    test("manifest agrees with repository on every fixture", () =>
    {
        const names = EngineFixture.FixtureNames();
        assert.ok(names.includes("aspects.todl"));
        assert.ok(names.includes("aspects-order.todl"));
        for (const name of names)
        {
            AgreementHarness.Check(EngineFixture.Repo([name]), name);
        }
        assert.ok(AgreementHarness.Check(EngineFixture.Repo(names), "corpus") > 0);
    });

    test("exactly the known-undeclared nodes are excluded from binding", () =>
    {
        // order-fulfillment.todl uses concepts (Lane, SequenceFlow) its metamodel never declares.
        const dropped = new Map<string, string[]>();
        for (const name of EngineFixture.FixtureNames())
            dropped.set(name, EngineFixture.Unbindable(EngineFixture.Repo([name])));
        for (const [name, ids] of dropped)
        {
            const expected = name === "order-fulfillment.todl" ? EngineFixture.ExpectedUnbindable : [];
            assert.deepEqual(ids, expected, `${name}: unbindable nodes`);
        }
    });

    test("aspect ordering: own, then inherited, then aspects; diamond carried once; wide closure order", () =>
    {
        const repo = EngineFixture.Repo(["aspects-order.todl"]);
        const manifest = EngineFixture.Graph(repo).manifests[0]!;
        const ns = "demo.aspectOrder.";
        const names = (type: string) => manifest.getType(ns + type)!.getFields().map((f) => f.name);
        assert.deepEqual(names("Phone"), [
            "phoneOwn", "gadgetOwn", "baseOwn", "wide", "mid1", "mid2", "leaf1", "leaf2",
        ]);
        assert.deepEqual(names("Device"), ["deviceOwn", "baseOwn", "location", "auditor", "tag"]);
        assert.deepEqual(
            manifest.getType(ns + "Device")!.getAspects().map((a) => a.name),
            ["Tracked", "Audited", "Asset"],
        );
        assert.deepEqual(
            manifest.getType(ns + "Phone")!.getAspects().map((a) => a.name),
            ["Wide", "Mid1", "Mid2", "Leaf1", "Leaf2"],
        );
    });

    test("a concept member shadows a same-named aspect member (first name wins)", () =>
    {
        const repo = EngineFixture.Repo(["aspects-order.todl"]);
        const manifest = EngineFixture.Graph(repo).manifests[0]!;
        const tag = manifest.getType("demo.aspectOrder.Clash")!.getFields().filter((f) => f.name === "tag");
        assert.equal(tag.length, 1);
        assert.equal(tag[0]!.declaringType.fullName, "demo.aspectOrder.Clash");
    });

    test("the aspects fixture's carriers are found through the aspect", () =>
    {
        const frozen = EngineFixture.Graph(EngineFixture.Repo(["aspects.todl"]));
        const ids = new GraphQuery(frozen).InstancesOf("demo.aspects.Asset").map((m) => m.node.id).sort();
        assert.deepEqual(ids, ["demo.aspects.lap01", "demo.aspects.rack01", "demo.aspects.web01"]);
    });
});
