import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { AccessScope, type GraphEngine } from "@pragmatic-tech-ai/graph";
import type { Repository } from "../../compiler-services/model/model.js";
import type { Node } from "../../compiler-services/model/graph.js";
import { MetaKind } from "../../compiler-services/model/kinds.js";
import { DescribeDiagnosticCode } from "../SnapshotDescription.js";
import { EngineFixture } from "./EngineFixture.js";

/** Counts of what one agreement check compared. */
interface IAgreementCounts
{
    readonly Instances: number;
    readonly Scans: number;
    readonly IsAPairs: number;
}

/** Compares the graph engine with the TODL Repository on instance membership and is-a. */
class EngineAgreement
{
    private static readonly BpmnPrefix = "adl.metaModels.bpmn.concepts.";
    private static readonly UnresolvedRelationships = ["livesIn", "incoming", "outgoing"];

    /** Instances the engine seeds: every non-class node typed by a concept (terms are todl.Term nodes). */
    private static InstancesOf(repo: Repository, concepts: readonly string[]): Node[]
    {
        const byId = new Map<string, Node>();
        for (const concept of concepts)
        {
            for (const node of repo.InstancesMatching(concept))
            {
                if (!repo.isClass(node.id) && node.type !== null) byId.set(node.id, node);
            }
        }
        return [...byId.values()];
    }

    private static async Scan(engine: GraphEngine, concept: string): Promise<string[]>
    {
        const reader = await engine.BeginRead(AccessScope.System);
        try
        {
            const ids: string[] = [];
            for await (const id of reader.ScanNodes(concept)) ids.push(id);
            return ids.sort();
        }
        finally
        {
            reader.dispose();
        }
    }

    public static async Check(repo: Repository, label: string, expectedDiagnostics: readonly string[]): Promise<IAgreementCounts>
    {
        const described = EngineFixture.Describe(EngineFixture.Graph(repo));
        assert.deepEqual(described.Diagnostics.map((d) => `${d.Code}:${d.Subject}`), expectedDiagnostics, `${label}: describe diagnostics`);
        const engine = await EngineFixture.Open(described);
        try
        {
            const concepts = [...repo.nodesOfMetaKind(MetaKind.Concept), ...repo.nodesOfMetaKind(MetaKind.Aspect)];
            const instances = EngineAgreement.InstancesOf(repo, concepts);
            const catalog = engine.Catalog;
            let pairs = 0;
            for (const x of concepts)
            {
                const expected = repo.InstancesMatching(x).filter((n) => !repo.isClass(n.id)).map((n) => n.id).sort();
                assert.deepEqual(await EngineAgreement.Scan(engine, x), expected, `${label}: ScanNodes(${x})`);
                for (const instance of instances)
                {
                    assert.equal(
                        catalog.IsA(instance.type!, x),
                        repo.IsA(instance.type!, x),
                        `${label}: IsA(type of ${instance.id} = ${instance.type}, ${x})`,
                    );
                    pairs++;
                }
            }
            return { Instances: instances.length, Scans: concepts.length, IsAPairs: pairs };
        }
        finally
        {
            await engine.dispose();
        }
    }

    /**
     * The diagnostics every fixture legitimately produces: concepts.todl (loaded with each) declares relationships to
     * Lane and SequenceFlow, which no fixture declares, so those relationships have no resolvable target. The
     * unbindable order-fulfillment nodes are filtered by the fixture before describing and add none.
     */
    public static Expected(): readonly string[]
    {
        const code = DescribeDiagnosticCode.UnresolvedType;
        const prefix = EngineAgreement.BpmnPrefix;
        return ["Task", "Event"].flatMap((type) => EngineAgreement.UnresolvedRelationships.map((rel) => `${code}:${prefix}${type}.${rel}`));
    }
}

describe("engine agrees with repository", () =>
{
    test("engine agrees with repository on every fixture", async () =>
    {
        const names = EngineFixture.FixtureNames();
        assert.ok(names.includes("aspects.todl"));
        let total = 0;
        for (const name of names)
        {
            const counts = await EngineAgreement.Check(EngineFixture.Repo([name]), name, EngineAgreement.Expected());
            console.log(`${name}: ${counts.Scans} scans, ${counts.Instances} instances, ${counts.IsAPairs} (instance, x) pairs`);
            total += counts.IsAPairs + counts.Scans;
        }
        const corpus = await EngineAgreement.Check(EngineFixture.Repo(names), "corpus", EngineAgreement.Expected());
        console.log(`corpus: ${corpus.Scans} scans, ${corpus.Instances} instances, ${corpus.IsAPairs} pairs`);
        assert.ok(total > 0 && corpus.IsAPairs > 0);
    });

    test("the describer reports no unattributed instance", async () =>
    {
        for (const name of EngineFixture.FixtureNames())
        {
            const { Diagnostics } = EngineFixture.Describe(EngineFixture.Graph(EngineFixture.Repo([name])));
            assert.equal(Diagnostics.filter((d) => d.Code === DescribeDiagnosticCode.Unattributed).length, 0, name);
        }
    });
});
