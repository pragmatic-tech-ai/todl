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
    private static readonly BpmnTypes = ["Task", "Event"];
    private static readonly DiagnosticsLabel = "describe diagnostics";
    private static readonly CorpusLabel = "corpus";
    private static readonly AspectsFixture = "aspects.todl";
    private static readonly AspectsOrderFixture = "aspects-order.todl";
    private static readonly OrderFixture = "order-fulfillment.todl";
    private static readonly ScanMessage = "{0}: ScanNodes({1})";
    private static readonly IsAMessage = "{0}: IsA(type of {1} = {2}, {3})";
    private static readonly CountsMessage = "{0}: {1} scans, {2} instances, {3} pairs";
    private static readonly CorpusMessage = "{0}: {1} instances, {2} pairs";
    private static readonly Placeholder = /\{(\d+)\}/g;
    private static readonly MissingArgument = "";
    private static readonly DiagnosticFormat = "{0}:{1}";
    /** Fixtures that declare instances: each must compare at least this many instances, so silent emptiness fails. */
    private static readonly MinimumInstances: ReadonlyMap<string, number> = new Map([
        [EngineAgreement.AspectsFixture, 4],
        [EngineAgreement.AspectsOrderFixture, 4],
        [EngineAgreement.OrderFixture, 4],
    ]);

    /** `template` with each `{n}` replaced by `args[n]`. */
    private static Format(template: string, ...args: string[]): string
    {
        return template.replace(EngineAgreement.Placeholder, (_, index: string) => args[Number(index)] ?? EngineAgreement.MissingArgument);
    }

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
        assert.deepEqual(described.Diagnostics.map((d) => EngineAgreement.Format(EngineAgreement.DiagnosticFormat, String(d.Code), d.Subject)), expectedDiagnostics, `${label}: ${EngineAgreement.DiagnosticsLabel}`);
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
                assert.deepEqual(await EngineAgreement.Scan(engine, x), expected, EngineAgreement.Format(EngineAgreement.ScanMessage, label, x));
                for (const instance of instances)
                {
                    assert.equal(
                        catalog.IsA(instance.type!, x),
                        repo.IsA(instance.type!, x),
                        EngineAgreement.Format(EngineAgreement.IsAMessage, label, instance.id, String(instance.type), x),
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

    /** Checks every fixture alone, then all together, against minimum instance counts. */
    public static async CheckAll(): Promise<void>
    {
        const names = EngineFixture.FixtureNames();
        assert.ok(names.includes(EngineAgreement.AspectsFixture));
        for (const name of names)
        {
            const counts = await EngineAgreement.Check(EngineFixture.Repo([name]), name, EngineAgreement.Expected());
            const minimum = EngineAgreement.MinimumInstances.get(name) ?? 0;
            const detail = EngineAgreement.Format(EngineAgreement.CountsMessage, name, String(counts.Scans), String(counts.Instances), String(counts.IsAPairs));
            assert.ok(counts.Scans > 0, detail);
            assert.ok(counts.Instances >= minimum && (minimum === 0 || counts.IsAPairs > 0), detail);
        }
        const corpus = await EngineAgreement.Check(EngineFixture.Repo(names), EngineAgreement.CorpusLabel, EngineAgreement.Expected());
        const total = [...EngineAgreement.MinimumInstances.values()].reduce((sum, n) => sum + n, 0);
        assert.ok(corpus.Instances >= total && corpus.IsAPairs > 0, EngineAgreement.Format(EngineAgreement.CorpusMessage, EngineAgreement.CorpusLabel, String(corpus.Instances), String(corpus.IsAPairs)));
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
        return EngineAgreement.BpmnTypes.flatMap((type) => EngineAgreement.UnresolvedRelationships.map((rel) => EngineAgreement.Format(EngineAgreement.DiagnosticFormat, String(code), `${prefix}${type}.${rel}`)));
    }
}

describe("engine agrees with repository", () =>
{
    test("engine agrees with repository on every fixture", async () =>
    {
        await EngineAgreement.CheckAll();
    });
});
