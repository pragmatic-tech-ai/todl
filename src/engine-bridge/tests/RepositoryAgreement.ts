import assert from "node:assert/strict";
import { AccessScope, type GraphEngine } from "@pragmatic-tech-ai/graph";
import type { Repository } from "../../compiler-services/model/model.js";
import type { Node } from "../../compiler-services/model/graph.js";
import { MetaKind } from "../../compiler-services/model/kinds.js";
import { toJSON } from "../../compiler-services/emit/json.js";
import { CompileFoundation, FoundationKind } from "../../compiler-services/stdlib/compile-foundation.js";
import { MessageFormat } from "../MessageFormat.js";
import { TodlNames } from "../TodlNames.js";

/** Counts of what one agreement check compared. */
export interface IAgreementCounts
{
    readonly Instances: number;
    readonly Scans: number;
    readonly IsAPairs: number;
}

/**
 * The Task 6 assertion: the graph engine agrees with a TODL Repository on instance membership (ScanNodes of every
 * concept and aspect equals the repository's non-class instances matching it) and on is-a (Catalog.IsA equals
 * Repository.IsA for every instance type against every concept and aspect). The engine seeds every taxonomy term as a
 * `todl.Term` node under the reserved `todl.Element` root (the describer's mapping), so ScanNodes(todl.Term) must equal
 * the repository's terms and the root's scan holds them too, which the repository's `todl.Element` instances do not.
 */
export class RepositoryAgreement
{
    private static readonly ScanMessage = "{0}: ScanNodes({1})";
    private static readonly IsAMessage = "{0}: IsA(type of {1} = {2}, {3})";

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

    /** Asserts `engine` agrees with `repo`; `label` prefixes every failure message. */
    public static async Compare(engine: GraphEngine, repo: Repository, label: string): Promise<IAgreementCounts>
    {
        // The described closure leaves out the seeded todl.system nodes the model never uses, so the engine has no such types.
        const unused = CompileFoundation.UnusedSystemIds(FoundationKind.PreludeAndSystem, toJSON(repo));
        const concepts = [...repo.nodesOfMetaKind(MetaKind.Concept), ...repo.nodesOfMetaKind(MetaKind.Aspect)].filter((x) => !unused.has(x));
        const seeded = RepositoryAgreement.InstancesOf(repo, concepts);
        const catalog = engine.Catalog;
        let pairs = 0;
        const terms = repo.nodesOfMetaKind(MetaKind.Term);
        assert.deepEqual(await RepositoryAgreement.Scan(engine, TodlNames.Term), [...terms].sort(), MessageFormat.Format(RepositoryAgreement.ScanMessage, label, TodlNames.Term));
        for (const x of concepts)
        {
            const instances = repo.InstancesMatching(x).filter((n) => !repo.isClass(n.id)).map((n) => n.id);
            const expected = (x === TodlNames.Element ? [...instances, ...terms] : instances).sort();
            assert.deepEqual(await RepositoryAgreement.Scan(engine, x), expected, MessageFormat.Format(RepositoryAgreement.ScanMessage, label, x));
            for (const instance of seeded)
            {
                assert.equal(
                    catalog.IsA(instance.type!, x),
                    repo.IsA(instance.type!, x),
                    MessageFormat.Format(RepositoryAgreement.IsAMessage, label, instance.id, String(instance.type), x),
                );
                pairs++;
            }
        }
        return { Instances: seeded.length, Scans: concepts.length, IsAPairs: pairs };
    }
}
