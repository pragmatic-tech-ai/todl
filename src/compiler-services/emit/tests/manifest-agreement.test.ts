import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { load } from "../../parse/loader.js";
import type { Repository } from "../../model/model.js";
import { MetaKind } from "../../model/kinds.js";
import { ManifestEmitter } from "../manifest.js";
import { ManifestWriter } from "../../../manifest/manifest-writer.js";
import { Manifest } from "../../../manifest/reflection/reflection.js";
import { FrozenGraph } from "../../../domain/graph.js";
import { GraphQuery } from "../../../graph-api/graph-query-engine.js";

/** Builds the repository and manifest-side view of fixtures so the two can be compared. */
class AgreementHarness
{
    private static readonly FixtureDir = new URL("../../parse/tests/fixtures/", import.meta.url);
    private static readonly Model = "agree";
    private static readonly Version = "1.0.0";
    private static readonly FixtureExtension = ".todl";
    /** The metamodel fixtures the instance fixtures import; loaded with every fixture so its types resolve. */
    private static readonly Dependencies = ["primitives.todl", "enums.todl", "concepts.todl"];

    public static FixtureNames(): string[]
    {
        return readdirSync(fileURLToPath(AgreementHarness.FixtureDir))
            .filter((f) => f.endsWith(AgreementHarness.FixtureExtension))
            .sort();
    }

    public static Source(name: string): { uri: string; text: string }
    {
        const text = readFileSync(fileURLToPath(new URL(name, AgreementHarness.FixtureDir)), "utf8");
        return { uri: name, text };
    }

    public static Repo(names: string[]): Repository
    {
        const all = [...new Set([...AgreementHarness.Dependencies, ...names])];
        return load(all.map((n) => AgreementHarness.Source(n))).model;
    }

    public static Graph(repo: Repository): FrozenGraph
    {
        const { manifest, graph } = new ManifestEmitter(repo, AgreementHarness.Model, AgreementHarness.Version).emit();
        const reflected = Manifest.load(ManifestWriter.fromLogical(manifest).toBinary());
        const frozen = new FrozenGraph();
        frozen.PreRegister(reflected);
        frozen.Finalize(reflected);
        // order-fulfillment.todl uses a concept (Lane) its metamodel never declares; such nodes cannot bind.
        const known = new Set(Object.keys(manifest.concepts));
        const nodes = graph.nodes.filter((n) => known.has(n.type));
        const ids = new Set(nodes.map((n) => n.id));
        const edges = graph.edges.filter((e) => ids.has(e.from) && ids.has(e.to));
        frozen.BindSeed({ ...graph, nodes, edges }, graph.manifestRef);
        return frozen;
    }

    /** Asserts manifest and repository agree; returns the number of (type, target) pairs compared. */
    public static Check(repo: Repository, label: string): number
    {
        const frozen = AgreementHarness.Graph(repo);
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
            assert.deepEqual(
                type.getFields().map((f) => f.name),
                repo.effectiveSchema(typeId).fields.map((f) => f.name),
                `${label}: fields of ${typeId}`,
            );
            assert.deepEqual(
                type.getRelationships().map((r) => r.name),
                repo.effectiveSchema(typeId).relationships.map((r) => r.name),
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
        const names = AgreementHarness.FixtureNames();
        assert.ok(names.includes("aspects.todl"));
        for (const name of names)
        {
            AgreementHarness.Check(AgreementHarness.Repo([name]), name);
        }
        assert.ok(AgreementHarness.Check(AgreementHarness.Repo(names), "corpus") > 0);
    });

    test("the aspects fixture's carriers are found through the aspect", () =>
    {
        const frozen = AgreementHarness.Graph(AgreementHarness.Repo(["aspects.todl"]));
        const ids = new GraphQuery(frozen).InstancesOf("demo.aspects.Asset").map((m) => m.node.id).sort();
        assert.deepEqual(ids, ["demo.aspects.lap01", "demo.aspects.rack01", "demo.aspects.web01"]);
    });
});
