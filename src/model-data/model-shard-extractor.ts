// Per-model document transform: given a package TodlDocument and a model id,
// produce the sub-document of shared ontology + only that model's Contains-
// closure of instances. The model container node (type: null) and all Contains
// edges are stripped — including them would make FrozenGraph.BindSeed throw.
// A ModelDataSource materialized from a shard is therefore scoped to that model.

import { MetaKind } from "../compiler-services/model/kinds.js";
import type { NodeId } from "../compiler-services/model/graph.js";
import type { TodlDocument, JsonNode } from "../compiler-services/emit/json.js";

export class ModelShardExtractor
{
    private static readonly InstanceTier = "Instance";
    private static readonly ContainsKind = "Contains";

    /** Every model container id in the document (metaKind === MetaKind.Model). */
    static ModelsOf(doc: TodlDocument): readonly NodeId[]
    {
        const models: NodeId[] = [];
        for (const node of doc.nodes)
        {
            if (node.metaKind === MetaKind.Model) models.push(node.id);
        }
        return models;
    }

    /** The sub-document for one model: shared ontology + its Contains-closure instances. */
    static Extract(doc: TodlDocument, modelId: NodeId): TodlDocument
    {
        const contained = ModelShardExtractor.closureOf(doc, modelId);
        const retained = new Set<NodeId>();
        const nodes: JsonNode[] = [];
        for (const node of doc.nodes)
        {
            const keep = ModelShardExtractor.isOntology(node)
                || (ModelShardExtractor.isInstanceData(node) && contained.has(node.id));
            if (keep)
            {
                nodes.push(node);
                retained.add(node.id);
            }
        }
        const edges = doc.edges.filter(
            (e) => e.kind !== ModelShardExtractor.ContainsKind && retained.has(e.from) && retained.has(e.to),
        );
        return { nodes, edges };
    }

    /** Instance ids transitively reached from modelId via Contains edges. */
    private static closureOf(doc: TodlDocument, modelId: NodeId): Set<NodeId>
    {
        const children = new Map<NodeId, NodeId[]>();
        for (const e of doc.edges)
        {
            if (e.kind !== ModelShardExtractor.ContainsKind) continue;
            const list = children.get(e.from);
            if (list === undefined) children.set(e.from, [e.to]);
            else list.push(e.to);
        }
        const out = new Set<NodeId>();
        const stack: NodeId[] = [...(children.get(modelId) ?? [])];
        while (stack.length > 0)
        {
            const id = stack.pop()!;
            if (out.has(id)) continue;
            out.add(id);
            for (const c of children.get(id) ?? []) stack.push(c);
        }
        return out;
    }

    /** An ontology declaration node — kept in every shard (concept/class/taxonomy/field/etc.). */
    private static isOntology(node: JsonNode): boolean
    {
        if (node.metaKind === MetaKind.Model) return false;
        if (node.isClass) return true;
        return node.tier !== ModelShardExtractor.InstanceTier;
    }

    /** A concept instance node — shardable per model. */
    private static isInstanceData(node: JsonNode): boolean
    {
        return node.tier === ModelShardExtractor.InstanceTier
            && node.metaKind !== MetaKind.Model
            && !node.isClass
            && node.type !== null;
    }
}
