import {
    AccessScope,
    And,
    Compare,
    CompareOp,
    EdgeDirection,
    FalsePredicate,
    IdIn,
    In,
    IsNull,
    Not,
    Or,
    Related,
    TruePredicate,
    ValueType,
    type AccessDefault,
    type CellValue,
    type IWriteRules,
    type Predicate,
} from '@pragmatic-tech-ai/graph';
import { Builder } from '../compiler-services/model/builder.js';
import { MetaKind } from '../compiler-services/model/kinds.js';
import { Cardinality } from '../manifest/enums.js';
import { ScalarBase, type Repository } from '../compiler-services/model/model.js';
import { PolicyPredicateCodec } from '../compiler-services/policy/policy-predicate-codec.js';
import {
    PolicyBoolOp,
    PolicyCompareOp,
    PolicyNodeKind,
    PolicyRefRoot,
    type PolicyOperand,
    type PolicyPredicate,
    type PolicyRef,
} from '../compiler-services/policy/policy-predicate.js';
import type { IPrincipalFacts } from './PrincipalFacts.js';

/** Why a policy leaf could not be expressed in engine terms. Append-only: never renumber or reuse a value. */
export enum PolicyDiagnosticCode
{
    /** `entity.a` compared with (or tested in) `entity.b`: the engine compares a member only with a constant. */
    EntityToEntity = 1,
    /** A comparison on a relationship member (`entity.rel == x`). */
    RelationshipCompare,
    /** An `entity.<name>` that is not a member of the concept. */
    UnknownMember,
}

/** One leaf compiled fail-closed because the engine cannot express it. */
export interface IPolicyDiagnostic
{
    readonly Code: PolicyDiagnosticCode;
    readonly Concept: string;
    readonly Message: string;
}

enum PolicyEffect
{
    Allow = 1,
    Deny,
}

enum PolicyAction
{
    Read = 1,
    Write,
}

enum MemberShape
{
    Property = 1,
    Relationship,
}

interface IPolicyRule
{
    readonly Effect: PolicyEffect;
    readonly Action: PolicyAction;
    readonly Predicate: PolicyPredicate;
}

interface IMemberInfo
{
    readonly Shape: MemberShape;
    /** The engine value type of a property. */
    readonly Type: ValueType;
}

/** A policy operand with its principal side already read: the entity member, or a constant. */
interface IOperand
{
    readonly Member?: string;
    readonly Value?: unknown;
}

/** Compiles the leaves and combinators of one concept's rules for one principal. */
class TermCompiler
{
    private static readonly MsgEntityToEntity = 'comparison of two entity members of "{0}" cannot be expressed in engine terms';
    private static readonly MsgRelationship = 'comparison on relationship "{1}" of "{0}" cannot be expressed in engine terms';
    private static readonly MsgUnknownMember = '"{1}" is not a member of "{0}"';
    private static readonly ConceptSlot = '{0}';
    private static readonly MemberSlot = '{1}';

    public constructor(
        private readonly concept: string,
        private readonly members: ReadonlyMap<string, IMemberInfo>,
        private readonly facts: IPrincipalFacts,
        private readonly diagnostics: IPolicyDiagnostic[])
    {
    }

    /** `failure` is what an inexpressible leaf compiles to at this position; it flips under Not. */
    public Compile(node: PolicyPredicate, failure: Predicate): Predicate
    {
        switch (node.kind)
        {
            case PolicyNodeKind.Compare:
                return this.CompileCompare(node.op, node.left, node.right, failure);
            case PolicyNodeKind.Membership:
                return this.CompileMembership(node.collection, node.item, failure);
            case PolicyNodeKind.Bool:
            {
                const terms = [this.Compile(node.left, failure), this.Compile(node.right, failure)];
                return node.op === PolicyBoolOp.And ? new And(terms) : new Or(terms);
            }
            case PolicyNodeKind.Not:
                return new Not(this.Compile(node.operand, failure === TruePredicate.Instance ? FalsePredicate.Instance : TruePredicate.Instance));
        }
    }

    // ── comparison ─────────────────────────────────────────────────────────

    private CompileCompare(op: PolicyCompareOp, left: PolicyOperand, right: PolicyOperand, failure: Predicate): Predicate
    {
        const l = this.Read(left);
        const r = this.Read(right);
        const equal = op === PolicyCompareOp.Eq;
        if (l.Member === undefined && r.Member === undefined)
        {
            return TermCompiler.Bool((l.Value === r.Value) === equal);
        }
        if (l.Member !== undefined && r.Member !== undefined)
        {
            return this.Fail(PolicyDiagnosticCode.EntityToEntity, TermCompiler.MsgEntityToEntity, failure);
        }
        const member = (l.Member ?? r.Member)!;
        const value = l.Member !== undefined ? r.Value : l.Value;
        if (this.IsId(member))
        {
            return typeof value === 'string' ? TermCompiler.Id(value, equal) : TermCompiler.Bool(!equal);
        }
        const info = this.members.get(member);
        if (info === undefined)
        {
            return this.Fail(PolicyDiagnosticCode.UnknownMember, TermCompiler.MsgUnknownMember, failure, member);
        }
        if (info.Shape === MemberShape.Relationship)
        {
            return this.Fail(PolicyDiagnosticCode.RelationshipCompare, TermCompiler.MsgRelationship, failure, member);
        }
        if (value === undefined || value === null)
        {
            return equal ? new IsNull(member) : new Not(new IsNull(member));
        }
        const cell = TermCompiler.Convert(info.Type, value);
        if (cell === undefined)
        {
            return TermCompiler.Bool(!equal);
        }
        return equal
            ? TermCompiler.Present(member, new Compare(member, CompareOp.Eq, cell))
            : new Or([new IsNull(member), new Compare(member, CompareOp.Ne, cell)]);
    }

    // ── membership ─────────────────────────────────────────────────────────

    private CompileMembership(collection: PolicyRef, item: PolicyOperand, failure: Predicate): Predicate
    {
        const source = this.Read(collection);
        const element = this.Read(item);
        if (source.Member === undefined)
        {
            return this.PrincipalCollection(source.Value, element, failure);
        }
        if (element.Member !== undefined)
        {
            return this.Fail(PolicyDiagnosticCode.EntityToEntity, TermCompiler.MsgEntityToEntity, failure);
        }
        return this.EntityCollection(source.Member, element.Value, failure);
    }

    /** `entity.m in principal.list` (or a fully constant membership). */
    private PrincipalCollection(list: unknown, element: IOperand, failure: Predicate): Predicate
    {
        if (!Array.isArray(list))
        {
            return FalsePredicate.Instance;
        }
        if (element.Member === undefined)
        {
            return TermCompiler.Bool(list.includes(element.Value));
        }
        const member = element.Member;
        const strings = new Set(list.filter((v): v is string => typeof v === 'string'));
        if (this.IsId(member))
        {
            return strings.size === 0 ? FalsePredicate.Instance : new IdIn(strings);
        }
        const info = this.members.get(member);
        if (info === undefined)
        {
            return this.Fail(PolicyDiagnosticCode.UnknownMember, TermCompiler.MsgUnknownMember, failure, member);
        }
        if (info.Shape === MemberShape.Relationship)
        {
            return strings.size === 0 ? FalsePredicate.Instance : new Related(member, EdgeDirection.Out, new IdIn(strings));
        }
        const cells: CellValue[] = [];
        for (const v of list)
        {
            const cell = TermCompiler.Convert(info.Type, v);
            if (cell !== undefined) cells.push(cell);
        }
        return cells.length === 0 ? FalsePredicate.Instance : TermCompiler.Present(member, new In(member, cells));
    }

    /** `principal.x in entity.m` / `entity.m has literal`. */
    private EntityCollection(member: string, value: unknown, failure: Predicate): Predicate
    {
        if (this.IsId(member))
        {
            return FalsePredicate.Instance;
        }
        const info = this.members.get(member);
        if (info === undefined)
        {
            return this.Fail(PolicyDiagnosticCode.UnknownMember, TermCompiler.MsgUnknownMember, failure, member);
        }
        if (value === undefined || value === null)
        {
            return FalsePredicate.Instance;
        }
        if (info.Shape === MemberShape.Relationship)
        {
            return typeof value === 'string' ? new Related(member, EdgeDirection.Out, new IdIn(new Set([value]))) : FalsePredicate.Instance;
        }
        const cell = TermCompiler.Convert(info.Type, value);
        return cell === undefined ? FalsePredicate.Instance : TermCompiler.Present(member, new Compare(member, CompareOp.Eq, cell));
    }

    // ── helpers ────────────────────────────────────────────────────────────

    private Read(operand: PolicyOperand): IOperand
    {
        if (operand.kind === PolicyNodeKind.Literal)
        {
            return { Value: operand.value };
        }
        return operand.root === PolicyRefRoot.Entity ? { Member: operand.member } : { Value: this.facts.Get(operand.member) };
    }

    private Fail(code: PolicyDiagnosticCode, template: string, failure: Predicate, member?: string): Predicate
    {
        const message = template.replace(TermCompiler.ConceptSlot, this.concept).replace(TermCompiler.MemberSlot, member ?? '');
        this.diagnostics.push({ Code: code, Concept: this.concept, Message: message });
        return failure;
    }

    /** `storageId` always names the node's id; `id` does unless the concept declares a member called that. */
    private IsId(member: string): boolean
    {
        return member === Builder.StorageIdKey || (member === Builder.IdMember && !this.members.has(member));
    }

    private static Id(value: string, equal: boolean): Predicate
    {
        const ids = new IdIn(new Set([value]));
        return equal ? ids : new Not(ids);
    }

    private static Bool(value: boolean): Predicate
    {
        return value ? TruePredicate.Instance : FalsePredicate.Instance;
    }

    /** A leaf that holds only when the member is set (an unset member must not yield Unknown). */
    private static Present(member: string, leaf: Predicate): Predicate
    {
        return new And([new Not(new IsNull(member)), leaf]);
    }

    /** A fact or literal as the member's engine cell, or undefined when it can never equal a member value. */
    private static Convert(type: ValueType, raw: unknown): CellValue | undefined
    {
        switch (type)
        {
            case ValueType.String:
                return typeof raw === 'string' ? raw : undefined;
            case ValueType.Boolean:
                return typeof raw === 'boolean' ? raw : undefined;
            case ValueType.Float64:
                return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
            case ValueType.Int64:
                return TermCompiler.ToInt64(raw);
            default:
                return undefined;
        }
    }

    private static ToInt64(raw: unknown): bigint | undefined
    {
        const value = typeof raw === 'bigint' ? raw : typeof raw === 'number' && Number.isInteger(raw) ? BigInt(raw) : undefined;
        return value !== undefined && BigInt.asIntN(64, value) === value ? value : undefined;
    }
}

/**
 * Compiles TODL policies (`policy <Concept> { allow|deny read|write when ... }`) into an engine
 * `AccessScope` for one principal, so the engine enforces them on every read and write. The compiled
 * scope mirrors the identity engine's evaluator: absent principal facts read as undefined, an unset
 * member never makes a leaf Unknown, and a leaf the engine cannot express compiles fail-closed (False in
 * an allow rule, True in a deny rule) and is reported on `Diagnostics`.
 */
export class PolicyScopeCompiler
{
    private static readonly AllowToken = 'allow';
    private static readonly DenyToken = 'deny';
    private static readonly ReadToken = 'read';
    private static readonly WriteToken = 'write';
    private static readonly MissingMessage = 'policy node "{0}" is missing concept or rules';
    private static readonly EffectMessage = 'policy for "{0}" has unknown effect "{1}"';
    private static readonly ActionMessage = 'policy for "{0}" has unknown action "{1}"';
    private static readonly Slot0 = '{0}';
    private static readonly Slot1 = '{1}';
    private static readonly Scalars: ReadonlyMap<ScalarBase, ValueType> = new Map<ScalarBase, ValueType>([
        [ScalarBase.String, ValueType.String],
        [ScalarBase.Number, ValueType.Float64],
        [ScalarBase.Integer, ValueType.Int64],
        [ScalarBase.Boolean, ValueType.Boolean],
    ]);

    private readonly diagnostics: IPolicyDiagnostic[] = [];

    private constructor(
        private readonly rulesByConcept: ReadonlyMap<string, readonly IPolicyRule[]>,
        private readonly membersByConcept: ReadonlyMap<string, ReadonlyMap<string, IMemberInfo>>)
    {
    }

    /** Leaves of the last `Compile` that the engine cannot express (each compiled fail-closed). */
    public get Diagnostics(): readonly IPolicyDiagnostic[]
    {
        return this.diagnostics;
    }

    public static FromRepository(repo: Repository): PolicyScopeCompiler
    {
        const rules = new Map<string, readonly IPolicyRule[]>();
        const members = new Map<string, ReadonlyMap<string, IMemberInfo>>();
        for (const id of repo.nodesOfMetaKind(MetaKind.Policy))
        {
            const node = repo.resolve(id);
            const concept = node?.attrs.get(Builder.PolicyConceptAttr);
            const raw = node?.attrs.get(Builder.PolicyRulesAttr);
            if (concept === undefined || raw === undefined)
            {
                throw new Error(PolicyScopeCompiler.MissingMessage.replace(PolicyScopeCompiler.Slot0, id));
            }
            const name = String(concept);
            rules.set(name, PolicyScopeCompiler.ParseRules(String(raw), name));
            members.set(name, PolicyScopeCompiler.MembersOf(repo, name));
        }
        return new PolicyScopeCompiler(rules, members);
    }

    public Compile(principal: IPrincipalFacts, defaultAccess: AccessDefault): AccessScope
    {
        this.diagnostics.length = 0;
        const rows = new Map<string, Predicate>();
        const writes = new Map<string, IWriteRules>();
        for (const [concept, rules] of this.rulesByConcept)
        {
            const terms = new TermCompiler(concept, this.membersByConcept.get(concept)!, principal, this.diagnostics);
            rows.set(concept, PolicyScopeCompiler.Combine(rules, PolicyAction.Read, terms));
            const write = PolicyScopeCompiler.Combine(rules, PolicyAction.Write, terms);
            writes.set(concept, { Create: write, Update: write, Delete: write });
        }
        return AccessScope.Build({ Default: defaultAccess, Rows: rows, Writes: writes });
    }

    /** Or(allows) AND Not(Or(denies)); an action with no rules allows (as the evaluator does). */
    private static Combine(rules: readonly IPolicyRule[], action: PolicyAction, terms: TermCompiler): Predicate
    {
        const forAction = rules.filter((r) => r.Action === action);
        const allows = forAction.filter((r) => r.Effect === PolicyEffect.Allow).map((r) => terms.Compile(r.Predicate, FalsePredicate.Instance));
        const denies = forAction.filter((r) => r.Effect === PolicyEffect.Deny).map((r) => terms.Compile(r.Predicate, TruePredicate.Instance));
        if (denies.length === 0)
        {
            return allows.length === 0 ? TruePredicate.Instance : new Or(allows);
        }
        return new And([allows.length === 0 ? TruePredicate.Instance : new Or(allows), new Not(new Or(denies))]);
    }

    private static ParseRules(json: string, concept: string): readonly IPolicyRule[]
    {
        const parsed = JSON.parse(json) as { effect: string; action: string; predicate: unknown }[];
        return parsed.map((entry) => ({
            Effect: PolicyScopeCompiler.EffectOf(entry.effect, concept),
            Action: PolicyScopeCompiler.ActionOf(entry.action, concept),
            Predicate: PolicyPredicateCodec.FromJson(JSON.stringify(entry.predicate)),
        }));
    }

    private static EffectOf(token: string, concept: string): PolicyEffect
    {
        if (token === PolicyScopeCompiler.AllowToken) return PolicyEffect.Allow;
        if (token === PolicyScopeCompiler.DenyToken) return PolicyEffect.Deny;
        throw new Error(PolicyScopeCompiler.EffectMessage.replace(PolicyScopeCompiler.Slot0, concept).replace(PolicyScopeCompiler.Slot1, token));
    }

    private static ActionOf(token: string, concept: string): PolicyAction
    {
        if (token === PolicyScopeCompiler.ReadToken) return PolicyAction.Read;
        if (token === PolicyScopeCompiler.WriteToken) return PolicyAction.Write;
        throw new Error(PolicyScopeCompiler.ActionMessage.replace(PolicyScopeCompiler.Slot0, concept).replace(PolicyScopeCompiler.Slot1, token));
    }

    /** How the engine sees each member of the concept, mirroring SnapshotDescriber's field mapping. */
    private static MembersOf(repo: Repository, concept: string): ReadonlyMap<string, IMemberInfo>
    {
        const out = new Map<string, IMemberInfo>();
        const schema = repo.effectiveSchema(concept);
        for (const field of schema.fields)
        {
            const many = field.cardinality === Cardinality.Many || field.cardinality === Cardinality.OneOrMore;
            const kind = repo.resolve(field.type)?.metaKind;
            if (kind === MetaKind.Concept || kind === MetaKind.Aspect || (kind === MetaKind.Taxonomy && many))
            {
                out.set(field.name, { Shape: MemberShape.Relationship, Type: ValueType.String });
            }
            else if (kind === MetaKind.Taxonomy)
            {
                out.set(field.name, { Shape: MemberShape.Property, Type: ValueType.String });
            }
            else
            {
                const base = repo.scalarConstraintOf(field.type)?.base;
                out.set(field.name, { Shape: MemberShape.Property, Type: base === undefined ? ValueType.String : PolicyScopeCompiler.Scalars.get(base)! });
            }
        }
        for (const relationship of schema.relationships)
        {
            out.set(relationship.name, { Shape: MemberShape.Relationship, Type: ValueType.String });
        }
        return out;
    }
}
