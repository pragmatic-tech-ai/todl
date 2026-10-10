import type { Repository } from "../model/model.js";
import type { NodeId, Scalar } from "../model/graph.js";
import { EdgeKind, Direction } from "../model/graph.js";
import { MergeStrategy } from "../parse/ast.js";
import { Builder } from "../model/builder.js";
import { MetaKind } from "../model/kinds.js";
import { DisjointSet } from "./union-find.js";
import { type Diagnostic, DiagnosticCode, Severity } from "../diagnostics/diagnostic.js";

interface SerializedMergeRule
{
    field: string;
    strategy: `${MergeStrategy}`;
    source: string | null;
}

interface Contribution
{
    member: NodeId;
    value: Scalar;
}

export interface MergeDecision
{
    readonly canonical: NodeId;
    readonly member: string;
    readonly source: string;
    readonly winningNode: NodeId;
    readonly strategy?: MergeStrategy | undefined;
}

/** Collapses instances that are the same entity — by declared identity key value
 * and/or declarative match rules, clustered transitively — into one canonical node
 * (the lexicographically smallest NodeId), aliasing the rest, then folds the members'
 * attribute values and outgoing relationships onto the canonical under the declared
 * merge rules. Deterministic and idempotent. */
export class ResolutionPass
{
    private static readonly StorageKey = Builder.StorageIdKey;
    private static readonly TupleSeparator = "\u0000";

    private readonly decisions: MergeDecision[] = [];

    public constructor(
        private readonly model: Repository,
        private readonly provenance?: ReadonlyMap<string, string>,
    )
    {
    }

    /** Per-merged-field audit: which contribution (and source) won each canonical field. Additive; empty if no merges folded. */
    public Decisions(): readonly MergeDecision[]
    {
        return this.decisions;
    }

    private RecordDecision(canonical: NodeId, member: string, winner: Contribution, strategy?: MergeStrategy): void
    {
        this.decisions.push(
        {
            canonical,
            member,
            source: this.provenance?.get(winner.member) ?? "",
            winningNode: winner.member,
            strategy,
        });
    }

    public Resolve(): Diagnostic[]
    {
        this.decisions.length = 0;
        const keyOf = new Map<NodeId, string>();
        const rulesOf = new Map<NodeId, string[][]>();
        const mergeOf = new Map<NodeId, SerializedMergeRule[]>();

        for (const id of this.model.nodesOfMetaKind(MetaKind.Identity))
        {
            const node = this.model.resolve(id);
            const concept = node?.attrs.get(Builder.IdentityConceptAttr);
            const key = node?.attrs.get(Builder.IdentityKeyAttr);
            if (typeof concept === "string" && typeof key === "string") keyOf.set(concept, key);
        }
        for (const id of this.model.nodesOfMetaKind(MetaKind.Match))
        {
            const node = this.model.resolve(id);
            const concept = node?.attrs.get(Builder.MatchConceptAttr);
            const rulesRaw = node?.attrs.get(Builder.MatchRulesAttr);
            if (typeof concept !== "string" || typeof rulesRaw !== "string") continue;
            let rules: unknown;
            try { rules = JSON.parse(rulesRaw); }
            catch { continue; }
            if (!Array.isArray(rules)) continue;
            rulesOf.set(concept, rules as string[][]);
        }
        for (const id of this.model.nodesOfMetaKind(MetaKind.Merge))
        {
            const node = this.model.resolve(id);
            const concept = node?.attrs.get(Builder.MatchConceptAttr);
            const rulesRaw = node?.attrs.get(Builder.MergeRulesAttr);
            if (typeof concept !== "string" || typeof rulesRaw !== "string") continue;
            let rules: unknown;
            try { rules = JSON.parse(rulesRaw); }
            catch { continue; }
            if (!Array.isArray(rules)) continue;
            mergeOf.set(concept, rules as SerializedMergeRule[]);
        }

        const diagnostics: Diagnostic[] = [];
        const concepts = new Set<NodeId>([...keyOf.keys(), ...rulesOf.keys(), ...mergeOf.keys()]);
        for (const concept of concepts)
        {
            this.ResolveConcept(concept, keyOf.get(concept), rulesOf.get(concept) ?? [], mergeOf.get(concept) ?? [], diagnostics);
        }
        return diagnostics;
    }

    private ResolveConcept(concept: NodeId, key: string | undefined, rules: string[][], mergeRules: SerializedMergeRule[], diagnostics: Diagnostic[]): void
    {
        const instances = this.model.instancesOf(concept);
        const ds = new DisjointSet<NodeId>();
        for (const id of instances) ds.Add(id);

        if (key !== undefined) this.UnionByFieldTuple(ds, instances, [key]);
        for (const rule of rules) this.UnionByFieldTuple(ds, instances, rule);

        for (const cluster of ds.Clusters())
        {
            if (cluster.length < 2) continue;
            const sorted = [...cluster].sort();
            const canonical = sorted[0]!;
            const aliases = sorted.slice(1);
            for (const alias of aliases) this.model.alias(alias, canonical);
            this.MergeCluster(canonical, aliases, mergeRules, diagnostics);
        }
    }

    /** Fold every alias's authored attrs and outgoing relationships onto the canonical.
     * Reads raw node attrs (not effectiveFields) so a class-fixed value is not mistaken for an authored instance value. */
    private MergeCluster(canonical: NodeId, aliases: readonly NodeId[], mergeRules: SerializedMergeRule[], diagnostics: Diagnostic[]): void
    {
        const members = [canonical, ...aliases];
        const fields = new Set<string>();
        for (const m of members)
        {
            const node = this.model.resolve(m);
            if (node !== undefined) for (const f of node.attrs.keys()) fields.add(f);
        }

        for (const field of fields)
        {
            const contributions: Contribution[] = [];
            for (const m of members)
            {
                const v = this.model.resolve(m)?.attrs.get(field);
                if (v !== undefined) contributions.push({ member: m, value: v });
            }
            if (contributions.length === 0) continue;
            const distinct = new Set(contributions.map((c) => `${typeof c.value}:${String(c.value)}`));
            if (distinct.size === 1)
            {
                this.SetIfChanged(canonical, field, contributions[0]!.value);
                this.RecordDecision(canonical, field, contributions[0]!);
                continue;
            }
            const rule = mergeRules.find((r) => r.field === field);
            const chosen = rule === undefined ? undefined : this.ApplyRule(rule, contributions);
            if (chosen !== undefined)
            {
                this.SetIfChanged(canonical, field, chosen.value);
                this.RecordDecision(canonical, field, chosen, rule!.strategy as MergeStrategy);
                continue;
            }
            diagnostics.push({
                code: DiagnosticCode.ResolutionUnmergedConflict,
                severity: Severity.Error,
                message: `entity "${canonical}" has conflicting values for "${field}" and no merge rule resolves it`,
                span: null,
                node: canonical,
                path: field,
            });
        }

        this.MergeOutgoingEdges(canonical, aliases);
    }

    /** Write only when the canonical does not already hold exactly this value (no redundant change events). */
    private SetIfChanged(canonical: NodeId, field: string, value: Scalar): void
    {
        if (this.model.resolve(canonical)?.attrs.get(field) !== value) this.model.setAttr(canonical, field, value);
    }

    /** The winning contribution for a conflicted field, or undefined when the rule does not fire. */
    private ApplyRule(rule: SerializedMergeRule, contributions: readonly Contribution[]): Contribution | undefined
    {
        if (rule.strategy === MergeStrategy.Latest)
        {
            let best = contributions[0]!;
            for (const c of contributions) if (ResolutionPass.Greater(c.value, best.value)) best = c;
            return best;
        }
        if (rule.strategy === MergeStrategy.Source && rule.source !== null && this.provenance !== undefined)
        {
            return contributions.find((c) => this.provenance!.get(c.member) === rule.source);
        }
        return undefined;
    }

    private static Greater(a: Scalar, b: Scalar): boolean
    {
        if (typeof a === "number" && typeof b === "number") return a > b;
        return String(a) > String(b);
    }

    /** Fold each alias's outgoing Relationship edges onto the canonical (deduped, no self-loop). */
    private MergeOutgoingEdges(canonical: NodeId, aliases: readonly NodeId[]): void
    {
        for (const alias of aliases)
        {
            for (const edge of this.model.outEdges(alias))
            {
                if (edge.kind !== EdgeKind.Relationship) continue;
                if (edge.to === canonical) continue;
                const already = this.model.related(canonical, EdgeKind.Relationship, Direction.Out, edge.via);
                if (already.indexOf(edge.to) >= 0) continue;
                this.model.addEdge({ kind: EdgeKind.Relationship, via: edge.via, from: canonical, to: edge.to });
            }
        }
    }

    /** Union all instances that share the same defined value-tuple over `fields`.
     * Instances with any undefined field in the tuple are not grouped by this rule. */
    private UnionByFieldTuple(ds: DisjointSet<NodeId>, instances: readonly NodeId[], fields: readonly string[]): void
    {
        const buckets = new Map<string, NodeId>();
        for (const id of instances)
        {
            const values = fields.map((f) => this.FieldValue(id, f));
            if (values.some((v) => v === undefined)) continue;
            const signature = values.map((v) => `${typeof v}:${String(v)}`).join(ResolutionPass.TupleSeparator);
            const first = buckets.get(signature);
            if (first === undefined) buckets.set(signature, id);
            else ds.Union(first, id);
        }
    }

    private FieldValue(instanceId: NodeId, field: string): Scalar | undefined
    {
        if (field === ResolutionPass.StorageKey)
        {
            const stored = this.model.resolve(instanceId)?.storageId;
            return stored ?? undefined;
        }
        return this.model.effectiveFields(instanceId).get(field);
    }
}
