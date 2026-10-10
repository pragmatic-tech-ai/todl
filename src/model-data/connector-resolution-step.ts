import { mergeBases } from "../compiler-services/api.js";
import { Repository } from "../compiler-services/model/model.js";
import { preludeDocument, preludeNames } from "../compiler-services/stdlib/prelude.js";
import { toJSON, toJSONOwn, type TodlDocument } from "../compiler-services/emit/json.js";
import type { Diagnostic } from "../compiler-services/diagnostics/diagnostic.js";
import { ResolutionPass, type MergeDecision } from "../compiler-services/resolution/resolution-pass.js";
import type { SourceRef, WriteTarget } from "./connector-plan.js";

export interface ConnectorResolutionResult
{
    readonly document: TodlDocument;
    readonly writeTargets: ReadonlyMap<string, readonly WriteTarget[]>;
    readonly decisions: readonly MergeDecision[];
    readonly diagnostics: readonly Diagnostic[];
}

export class ConnectorResolutionStep
{
    private static readonly SourceSeparator = ".";

    public Resolve(document: TodlDocument, sources: ReadonlyMap<string, SourceRef>): ConnectorResolutionResult
    {
        const provenance = new Map<string, string>();
        for (const [id, ref] of sources)
        {
            provenance.set(id, `${ref.Connector}${ConnectorResolutionStep.SourceSeparator}${ref.Source}`);
        }

        const model = new Repository(mergeBases([preludeDocument(), document]));
        const pass = new ResolutionPass(model, provenance);
        const diagnostics = pass.Resolve();
        const decisions = pass.Decisions();
        const writeTargets = this.BuildWriteTargets(model, sources);
        const resolved = this.Collapse(model);
        return { document: resolved, writeTargets, decisions, diagnostics };
    }

    private BuildWriteTargets(model: Repository, sources: ReadonlyMap<string, SourceRef>): ReadonlyMap<string, WriteTarget[]>
    {
        const targets = new Map<string, WriteTarget[]>();
        for (const [nodeId, ref] of sources)
        {
            const node = model.resolve(nodeId);
            if (node === undefined || node.storageId === null) continue;
            const canonical = node.canonicalId ?? nodeId;
            const list = targets.get(canonical) ?? [];
            list.push({ StorageId: node.storageId, Connector: ref.Connector, Source: ref.Source });
            targets.set(canonical, list);
        }
        return targets;
    }

    private Collapse(model: Repository): TodlDocument
    {
        const prelude = preludeNames();
        const ownIds = new Set<string>();
        for (const node of toJSON(model).nodes)
        {
            if (!prelude.has(node.id) && node.canonicalId === null) ownIds.add(node.id);
        }
        return toJSONOwn(model, ownIds);
    }
}
