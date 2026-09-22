// Manifest + flattened data-graph emitter (SPEC-03 §emit pipeline). A new
// module sibling to json.ts; it does NOT modify toJSON. It reads the existing
// schema-reflection surface on Repository and produces two artifacts together:
//
//   - the LOGICAL manifest (meta/ontology tier: declared-only concept schemas,
//     the extends hierarchy, class/term + taxonomy definitions), and
//   - the flattened data graph (instance tier: self-contained nodes with
//     user-only attrs + relationship-only edges), pinned to the manifest.
//
// Flattening is INSTANCE-WINS: an instance's own value overrides its class's
// fixed value, and the class fills only fields the instance leaves unset. This
// is the only overlay under which Axis-2 value-origin is meaningful (a value
// can differ from its class), and it is the SPEC-01 target. It deliberately
// differs from Repository.effectiveFields (class-wins), which stays the
// resolution used by validation / typed clients. See JOURNAL (SPEC-03 note).

import { Repository } from "../model/model.js";
import { EdgeKind, Direction, Tier, type Scalar, type NodeId } from "../model/graph.js";
import { MetaKind } from "../model/kinds.js";
import {
    CardinalityGlyph,
    type LogicalManifest,
    type ConceptDef,
    type ClassDef,
    type RelationshipDef,
    type FieldDef,
    type TaxonomyDef,
    type AnnotationApp,
} from "../../manifest/logical.js";

/** The manifest version a data graph is pinned to. */
export interface ManifestRef
{
    model: string;
    version: string;
}

/** A flattened, self-contained instance node (SPEC-03 §graph). */
export interface DataNode
{
    id: string;
    type: string;
    class?: string;
    namespace: string;
    attrs: Record<string, Scalar>;
}

/** A relationship-only edge (`via` member name becomes `rel`). */
export interface DataEdge
{
    from: string;
    rel: string;
    to: string;
}

/** The sharded data-graph artifact. */
export interface DataGraph
{
    manifestRef: ManifestRef;
    nodes: DataNode[];
    edges: DataEdge[];
}

export class ManifestEmitter
{
    /** Structural markers that live in `attrs` today; never user data (idea #5). */
    private static readonly MARKERS = new Set(["class", "id", "namespace"]);

    constructor(
        private readonly repo: Repository,
        private readonly model: string,
        private readonly version: string,
    ) {}

    /** Emit both artifacts together. */
    emit(): { manifest: LogicalManifest; graph: DataGraph }
    {
        return { manifest: this.emitManifest(), graph: this.emitDataGraph() };
    }

    /** The replicated meta/ontology manifest. */
    emitManifest(): LogicalManifest
    {
        return {
            format: "todl-manifest/1",
            model: this.model,
            version: this.version,
            root: "Element",
            concepts: this.emitConcepts(),
            classes: this.emitClasses(),
            taxonomies: this.emitTaxonomies(),
        };
    }

    /** The sharded, flattened instance graph pinned to the manifest. */
    emitDataGraph(): DataGraph
    {
        return {
            manifestRef: { model: this.model, version: this.version },
            nodes: this.emitNodes(),
            edges: this.emitEdges(),
        };
    }

    // ── Manifest emission ─────────────────────────────────────────────────

    private emitConcepts(): Record<string, ConceptDef>
    {
        const out: Record<string, ConceptDef> = {};
        for (const id of this.repo.nodesOfMetaKind(MetaKind.Concept))
        {
            const schema = this.repo.schemaOf(id);
            const fields: Record<string, FieldDef> = {};
            for (const f of schema.fields)
                fields[f.name] = { type: f.type, card: CardinalityGlyph.toGlyph(f.cardinality) };
            const relationships: Record<string, RelationshipDef> = {};
            for (const r of schema.relationships)
            {
                const def: RelationshipDef = {
                    targets: r.targets,
                    card: CardinalityGlyph.toGlyph(r.cardinality),
                    annotations: this.annotationsOf(`${id}.${r.name}`),
                };
                if (r.inverse !== null) def.inverse = r.inverse;
                relationships[r.name] = def;
            }
            const invariants = this.repo
                .invariantsFor(id)
                .map((inv) => inv.description)
                .filter((s) => s.length > 0);
            out[id] = {
                extends: schema.extends, fields, relationships, invariants,
                annotations: this.annotationsOf(id),
            };
        }
        return out;
    }

    private emitClasses(): Record<string, ClassDef>
    {
        const out: Record<string, ClassDef> = {};
        for (const node of this.repo.allNodes())
        {
            if (!this.repo.isClass(node.id)) continue;
            const fixed: Record<string, Scalar> = {};
            for (const [key, value] of node.attrs)
                if (!ManifestEmitter.MARKERS.has(key)) fixed[key] = value;
            const def: ClassDef = {
                concept: node.type ?? "",
                narrower: this.repo.narrowerOf(node.id),
                fixed,
                annotations: this.annotationsOf(node.id),
            };
            const taxonomy = this.repo.related(node.id, EdgeKind.Contains, Direction.In)[0];
            if (taxonomy !== undefined) def.taxonomy = taxonomy;
            const broader = this.repo.broaderOf(node.id)[0];
            if (broader !== undefined) def.broader = broader;
            out[node.id] = def;
        }
        return out;
    }

    private emitTaxonomies(): Record<string, TaxonomyDef>
    {
        const out: Record<string, TaxonomyDef> = {};
        for (const id of this.repo.nodesOfMetaKind(MetaKind.Taxonomy))
        {
            const roots = this.repo.termsOf(id).filter((t) => this.repo.broaderOf(t).length === 0);
            out[id] = { represents: this.repo.represents(id), roots };
        }
        return out;
    }

    /** The annotations applied to `nodeId` (via Annotated edges → application nodes). */
    private annotationsOf(nodeId: NodeId): AnnotationApp[]
    {
        const out: AnnotationApp[] = [];
        for (const appId of this.repo.related(nodeId, EdgeKind.Annotated, Direction.Out))
        {
            const app = this.repo.resolve(appId);
            if (app === undefined || app.type === null) continue;
            const args: Record<string, Scalar> = {};
            for (const [key, value] of app.attrs)
                if (!ManifestEmitter.MARKERS.has(key)) args[key] = value;
            out.push({ annotation: app.type, args });
        }
        return out;
    }

    // ── Data-graph emission ───────────────────────────────────────────────

    private emitNodes(): DataNode[]
    {
        const nodes: DataNode[] = [];
        for (const node of this.repo.allNodes())
        {
            if (!this.isDataNode(node.tier, node.metaKind, node.id)) continue;
            const dn: DataNode = {
                id: node.id,
                type: node.type ?? "",
                namespace: node.namespace ?? "",
                attrs: this.flattenedAttrs(node.id),
            };
            const cls = this.repo.classOf(node.id);
            if (cls !== null) dn.class = cls;
            nodes.push(dn);
        }
        return nodes;
    }

    private emitEdges(): DataEdge[]
    {
        const edges: DataEdge[] = [];
        for (const node of this.repo.allNodes())
        {
            if (!this.isDataNode(node.tier, node.metaKind, node.id)) continue;
            for (const [rel, targets] of this.repo.effectiveRelationships(node.id))
                for (const to of targets) edges.push({ from: node.id, rel, to });
        }
        return edges;
    }

    /** An instance-tier domain node: not a class/term definition, not a model container. */
    private isDataNode(tier: Tier, metaKind: MetaKind | null, id: NodeId): boolean
    {
        return tier === Tier.Instance && metaKind !== MetaKind.Model && !this.repo.isClass(id);
    }

    /**
     * Instance-wins flattening: the class's fixed values fill fields the leaf
     * leaves unset, then the leaf's own values override. Structural markers are
     * stripped so `attrs` is user-only.
     */
    private flattenedAttrs(leaf: NodeId): Record<string, Scalar>
    {
        const result: Record<string, Scalar> = {};
        const cls = this.repo.classOf(leaf);
        if (cls !== null)
        {
            const clsNode = this.repo.resolve(cls);
            if (clsNode !== undefined)
                for (const [key, value] of clsNode.attrs)
                    if (!ManifestEmitter.MARKERS.has(key)) result[key] = value;
        }
        const own = this.repo.resolve(leaf)?.attrs;
        if (own !== undefined)
            for (const [key, value] of own)
                if (!ManifestEmitter.MARKERS.has(key)) result[key] = value;
        return result;
    }

    private static asString(value: Scalar | undefined): string
    {
        return typeof value === "string" ? value : "";
    }
}
