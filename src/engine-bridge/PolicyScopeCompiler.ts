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
    Reachable,
    Related,
    TruePredicate,
    ValueType,
    type AccessDefault,
    MemberKind,
    type CellValue,
    type IDefinitionDescription,
    type ISchemaDescription,
    type MemberInput,
    type IWriteRules,
    type Predicate,
} from '@pragmatic-tech-ai/graph';
import { Builder } from '../compiler-services/model/builder.js';
import { MetaKind } from '../compiler-services/model/kinds.js';
import { Cardinality } from '../manifest/enums.js';
import { ScalarBase, type Repository } from '../compiler-services/model/model.js';
import { PolicyAction, PolicyEffect, PolicyRules, type PolicyRule } from '../compiler-services/policy/policy-rules.js';
import {
    PolicyBoolOp,
    PolicyCompareOp,
    PolicyNodeKind,
    PolicyRefRoot,
    type PolicyOperand,
    type PolicyPredicate,
    type PolicyRef,
} from '../compiler-services/policy/policy-predicate.js';
import { NumericText } from '../compiler-services/emit/numeric-text.js';
import { MessageFormat } from './MessageFormat.js';
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
    /** `x in entity.m` / `entity.m has x`: the evaluator reads entity members as scalars, so it never matches. */
    NeverMatches,
    /** A `<concept>@policy` node whose rules cannot be read; the concept is compiled fail-closed. */
    MalformedPolicy,
    /** A policied concept the engine schema does not define (the describer dropped it); it falls to the scope Default. */
    UnknownConcept,
    /** A string compared with a numeric member that is not decimal text of the member's type; the leaf fails closed. */
    ValueTypeMismatch,
}

/** One leaf (or policy) compiled fail-closed or to a constant because the engine cannot express it. */
export interface IPolicyDiagnostic
{
    readonly Code: PolicyDiagnosticCode;
    readonly Concept: string;
    readonly Message: string;
}

/** How the engine sees one member of a policied concept (introspection, checked against the describer). */
export interface IPolicyMember
{
    readonly IsRelationship: boolean;
    /** The engine value type of a property (String for a relationship, unused). */
    readonly Type: ValueType;
}

enum MemberShape
{
    Property = 1,
    Relationship,
}

interface IMemberInfo
{
    readonly Shape: MemberShape;
    readonly Type: ValueType;
}

/** One concept's runtime policy as stored: the `AccessPolicySetting.Load` / `PolicyCatalog.FromPolicies` shape. */
export interface IPolicyRuleSource
{
    readonly concept: string;
    readonly rulesJson: string;
}

/** How a number or string meets a numeric member's engine value type. */
enum PolicyValueSemantics
{
    /** Entity values are decimal text (the dev repository): a string converts, a JS number never matches. */
    SourceText = 1,
    /** Entity values are typed (the runtime): a JS number converts, a string never matches (mirrors === on typed values). */
    Typed,
}

/** How a fact or literal meets a member's engine value type. */
enum ConversionOutcome
{
    /** It converts exactly to a cell of the member's type. */
    Cell = 1,
    /** It can never equal a member value (another JS type), as the evaluator's === sees it. */
    Never,
    /** A JS number against a numeric member: entity values are decimal text, so === never holds (ruling PF-a). */
    NeverNumber,
    /** A string that is not decimal text of the member's numeric type: the leaf fails closed (ruling PF-a). */
    Unconvertible,
}

interface IConversion
{
    readonly Outcome: ConversionOutcome;
    readonly Cell?: CellValue;
}

/** A policy operand with its principal side already read: the entity member, or a constant. */
interface IOperand
{
    readonly Member?: string;
    readonly Value?: unknown;
}

/** One concept's policy: its rules, or null when the node could not be read. */
interface IConceptPolicy
{
    readonly Rules: readonly PolicyRule[] | null;
    readonly Members: ReadonlyMap<string, IMemberInfo>;
}

/** The effective members of a concept as the engine computes them: own, then the parent chain, aspects included. */
class DescriptionMembers
{
    private readonly byName: ReadonlyMap<string, IDefinitionDescription>;

    public constructor(description: ISchemaDescription)
    {
        this.byName = new Map(description.Definitions.map((d) => [d.Name, d]));
    }

    /** True iff the schema defines `concept` as a concept (not an aspect). */
    public HasConcept(concept: string): boolean
    {
        const definition = this.byName.get(concept);
        return definition !== undefined && !definition.IsAspect;
    }

    /** Effective members of `concept`; the first declaration of a name wins. */
    public Of(concept: string): ReadonlyMap<string, IMemberInfo>
    {
        const out = new Map<string, IMemberInfo>();
        this.Collect(concept, out, new Set<string>());
        return out;
    }

    private Collect(name: string, out: Map<string, IMemberInfo>, seen: Set<string>): void
    {
        const definition = this.byName.get(name);
        if (definition === undefined || seen.has(name))
        {
            return;
        }
        seen.add(name);
        for (const member of definition.Members)
        {
            if (!out.has(member.Name))
            {
                out.set(member.Name, DescriptionMembers.InfoOf(member));
            }
        }
        for (const aspect of definition.Aspects)
        {
            this.Collect(aspect, out, seen);
        }
        if (definition.Parent !== null)
        {
            this.Collect(definition.Parent, out, seen);
        }
    }

    private static InfoOf(member: MemberInput): IMemberInfo
    {
        return member.Kind === MemberKind.Relationship
            ? { Shape: MemberShape.Relationship, Type: ValueType.String }
            : { Shape: MemberShape.Property, Type: member.Type ?? ValueType.String };
    }
}

/** Predicate construction that folds constants, so a principal-only term never leaves a needless tree. */
class Fold
{
    public static And(terms: readonly Predicate[]): Predicate
    {
        const kept: Predicate[] = [];
        for (const term of terms)
        {
            if (term === FalsePredicate.Instance) return FalsePredicate.Instance;
            if (term !== TruePredicate.Instance) kept.push(term);
        }
        if (kept.length === 0) return TruePredicate.Instance;
        return kept.length === 1 ? kept[0]! : new And(kept);
    }

    public static Or(terms: readonly Predicate[]): Predicate
    {
        const kept: Predicate[] = [];
        for (const term of terms)
        {
            if (term === TruePredicate.Instance) return TruePredicate.Instance;
            if (term !== FalsePredicate.Instance) kept.push(term);
        }
        if (kept.length === 0) return FalsePredicate.Instance;
        return kept.length === 1 ? kept[0]! : new Or(kept);
    }

    public static Not(term: Predicate): Predicate
    {
        if (term === TruePredicate.Instance) return FalsePredicate.Instance;
        if (term === FalsePredicate.Instance) return TruePredicate.Instance;
        return new Not(term);
    }

    public static Bool(value: boolean): Predicate
    {
        return value ? TruePredicate.Instance : FalsePredicate.Instance;
    }
}

/** Compiles the leaves and combinators of one concept's rules for one principal. */
class TermCompiler
{
    private static readonly MsgEntityToEntity = 'comparison of two entity members of "{0}" cannot be expressed in engine terms';
    private static readonly MsgRelationship = 'comparison on relationship "{1}" of "{0}" cannot be expressed in engine terms';
    private static readonly MsgUnknownMember = '"{1}" is not a member of "{0}"';
    private static readonly MsgNever = 'a membership test over an entity member of "{0}" never matches (entity members are scalars)';
    private static readonly MsgNumber = 'a number compared with member "{1}" of "{0}" never matches (entity values are held as decimal text; write the value as a string)';
    private static readonly MsgUnconvertible = 'a value compared with member "{1}" of "{0}" is not decimal text of its type; the leaf fails closed';
    private static readonly IntegerPattern = /^[+-]?\d+$/;
    private static readonly Int64Bits = 64;

    public constructor(
        private readonly concept: string,
        private readonly members: ReadonlyMap<string, IMemberInfo>,
        private readonly facts: IPrincipalFacts,
        private readonly diagnostics: IPolicyDiagnostic[],
        private readonly semantics: PolicyValueSemantics)
    {
    }

    /**
     * `failure` is what an inexpressible leaf compiles to at this position (False in an allow rule, True in a
     * deny rule); it flips under Not. Positions whose failure is True are the ones where matching MORE is safe,
     * which is where a leaf may use a form that sees hidden neighbours.
     */
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
                return node.op === PolicyBoolOp.And ? Fold.And(terms) : Fold.Or(terms);
            }
            case PolicyNodeKind.Not:
                return Fold.Not(this.Compile(node.operand, failure === TruePredicate.Instance ? FalsePredicate.Instance : TruePredicate.Instance));
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
            return Fold.Bool((l.Value === r.Value) === equal);
        }
        if (l.Member !== undefined && r.Member !== undefined)
        {
            return this.Fail(PolicyDiagnosticCode.EntityToEntity, TermCompiler.MsgEntityToEntity, failure);
        }
        const member = (l.Member ?? r.Member)!;
        const value = l.Member !== undefined ? r.Value : l.Value;
        if (this.IsId(member))
        {
            return typeof value === 'string' ? TermCompiler.Id(value, equal) : Fold.Bool(!equal);
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
        const converted = this.Convert(info.Type, value);
        switch (converted.Outcome)
        {
            case ConversionOutcome.Unconvertible:
                return this.Fail(PolicyDiagnosticCode.ValueTypeMismatch, TermCompiler.MsgUnconvertible, failure, member);
            case ConversionOutcome.NeverNumber:
                this.Report(PolicyDiagnosticCode.NeverMatches, TermCompiler.MsgNumber, member);
                return Fold.Bool(!equal);
            case ConversionOutcome.Never:
                return Fold.Bool(!equal);
            case ConversionOutcome.Cell:
                break;
        }
        const cell = converted.Cell!;
        return equal
            ? TermCompiler.Present(member, new Compare(member, CompareOp.Eq, cell))
            : new Or([new IsNull(member), new Compare(member, CompareOp.Ne, cell)]);
    }

    // ── membership ─────────────────────────────────────────────────────────

    private CompileMembership(collection: PolicyRef, item: PolicyOperand, failure: Predicate): Predicate
    {
        const source = this.Read(collection);
        const element = this.Read(item);
        if (source.Member !== undefined)
        {
            // The evaluator reads an entity member as a scalar, so `includes` on it is always false.
            return this.Fail(PolicyDiagnosticCode.NeverMatches, TermCompiler.MsgNever, FalsePredicate.Instance);
        }
        return this.PrincipalCollection(source.Value, element, failure);
    }

    /** `entity.m in principal.list` (or a fully constant membership). */
    private PrincipalCollection(list: unknown, element: IOperand, failure: Predicate): Predicate
    {
        if (element.Member === undefined)
        {
            return Fold.Bool(Array.isArray(list) && list.includes(element.Value));
        }
        const member = element.Member;
        const id = this.IsId(member);
        const info = this.members.get(member);
        if (!id && info === undefined)
        {
            return this.Fail(PolicyDiagnosticCode.UnknownMember, TermCompiler.MsgUnknownMember, failure, member);
        }
        if (!Array.isArray(list))
        {
            return FalsePredicate.Instance;
        }
        const strings = new Set(list.filter((v): v is string => typeof v === 'string'));
        if (id)
        {
            return strings.size === 0 ? FalsePredicate.Instance : new IdIn(strings);
        }
        if (info!.Shape === MemberShape.Relationship)
        {
            return strings.size === 0 ? FalsePredicate.Instance : TermCompiler.Links(member, strings, failure);
        }
        const cells: CellValue[] = [];
        for (const v of list)
        {
            const converted = this.Convert(info!.Type, v);
            if (converted.Outcome === ConversionOutcome.Unconvertible)
            {
                return this.Fail(PolicyDiagnosticCode.ValueTypeMismatch, TermCompiler.MsgUnconvertible, failure, member);
            }
            if (converted.Outcome === ConversionOutcome.NeverNumber)
            {
                this.Report(PolicyDiagnosticCode.NeverMatches, TermCompiler.MsgNumber, member);
            }
            if (converted.Outcome === ConversionOutcome.Cell) cells.push(converted.Cell!);
        }
        return cells.length === 0 ? FalsePredicate.Instance : TermCompiler.Present(member, new In(member, cells));
    }

    // ── helpers ────────────────────────────────────────────────────────────

    /**
     * "Relationship `member` links to one of `targets`". The evaluator reads raw member values, so the form
     * must not depend on whether the reader may see the target. Related only counts visible neighbours (narrower
     * than the evaluator: safe where matching less is safe, i.e. an allow position). Where matching more is safe
     * (failure True: deny, or an odd number of Nots) Reachable is used: it walks unscoped edges from the targets,
     * so it also matches the targets themselves, which can only widen a deny.
     */
    private static Links(member: string, targets: ReadonlySet<string>, failure: Predicate): Predicate
    {
        if (failure === TruePredicate.Instance)
        {
            return new Reachable(targets, [{ Relationship: member, Direction: EdgeDirection.In }], 1);
        }
        return new Related(member, EdgeDirection.Out, new IdIn(targets));
    }

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
        this.Report(code, template, member);
        return failure;
    }

    /** `template` takes the concept as {0} and, when given, the member as {1}. */
    private Report(code: PolicyDiagnosticCode, template: string, member?: string): void
    {
        const message = member === undefined ? MessageFormat.Format(template, this.concept) : MessageFormat.Format(template, this.concept, member);
        this.diagnostics.push({ Code: code, Concept: this.concept, Message: message });
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

    /** A leaf that holds only when the member is set (an unset member must not yield Unknown). */
    private static Present(member: string, leaf: Predicate): Predicate
    {
        return new And([new Not(new IsNull(member)), leaf]);
    }

    /**
     * A fact or literal against a member's engine type. Strings and booleans convert only from their own JS type
     * under both semantics. Numeric members depend on the semantics.
     *
     * SourceText mirrors the evaluator's === on raw entity values (rulings PF-a, PF-f): TODL holds numeric entity
     * values as decimal text, so a string in the canonical text of a number (`2`, `-3`, `2.5`, `1e+21`) converts to
     * that number, a JS number never equals one, and any other string (`02`, `+2`, `2.0`, `0x10`, `1e1`, `.5`) fails
     * closed, since its text could never equal a canonical entity value. Residual: the entity side is typed storage,
     * so a non-canonical value seeded from a `.todl` file (`count = "02"`) is held as its number and matches the
     * canonical claim `"2"`, where the evaluator's raw text would not.
     *
     * Typed mirrors === on typed runtime values: a JS number converts (Int64: an integral safe number becomes a
     * bigint, a fractional or unsafe one never matches; Float64: a finite number), and a string against a numeric
     * member never matches, with no diagnostic.
     */
    private Convert(type: ValueType, raw: unknown): IConversion
    {
        switch (type)
        {
            case ValueType.String:
                return typeof raw === 'string' ? TermCompiler.Cell(raw) : TermCompiler.Outcome(ConversionOutcome.Never);
            case ValueType.Boolean:
                return typeof raw === 'boolean' ? TermCompiler.Cell(raw) : TermCompiler.Outcome(ConversionOutcome.Never);
            case ValueType.Float64:
                return this.semantics === PolicyValueSemantics.Typed
                    ? TermCompiler.TypedNumber(raw, Number.isFinite, (n) => n)
                    : TermCompiler.Numeric(raw, (text) => TermCompiler.ToFloat64(text));
            case ValueType.Int64:
                return this.semantics === PolicyValueSemantics.Typed
                    ? TermCompiler.TypedNumber(raw, Number.isSafeInteger, (n) => BigInt(n))
                    : TermCompiler.Numeric(raw, (text) => TermCompiler.ToInt64(text));
            default:
                return TermCompiler.Outcome(ConversionOutcome.Never);
        }
    }

    /** Typed numeric member: a JS number that `accepts` converts through `toCell`; anything else never matches. */
    private static TypedNumber(raw: unknown, accepts: (n: number) => boolean, toCell: (n: number) => CellValue): IConversion
    {
        return typeof raw === 'number' && accepts(raw) ? TermCompiler.Cell(toCell(raw)) : TermCompiler.Outcome(ConversionOutcome.Never);
    }

    private static Numeric(raw: unknown, parse: (text: string) => CellValue | undefined): IConversion
    {
        if (typeof raw === 'number')
        {
            return TermCompiler.Outcome(ConversionOutcome.NeverNumber);
        }
        if (typeof raw !== 'string')
        {
            return TermCompiler.Outcome(ConversionOutcome.Never);
        }
        const cell = parse(raw);
        return cell === undefined ? TermCompiler.Outcome(ConversionOutcome.Unconvertible) : TermCompiler.Cell(cell);
    }

    /** The canonical decimal text of an integer within the signed 64-bit range (`String(BigInt(t)) === t`). */
    private static ToInt64(text: string): bigint | undefined
    {
        if (!TermCompiler.IntegerPattern.test(text))
        {
            return undefined;
        }
        const value = BigInt(text);
        return String(value) === text && BigInt.asIntN(TermCompiler.Int64Bits, value) === value ? value : undefined;
    }

    /** The canonical text of a finite number (`NumericText.Of(Number(t)) === t`). */
    private static ToFloat64(text: string): number | undefined
    {
        const value = Number(text);
        return Number.isFinite(value) && NumericText.Of(value) === text ? value : undefined;
    }

    private static Cell(cell: CellValue): IConversion
    {
        return { Outcome: ConversionOutcome.Cell, Cell: cell };
    }

    private static Outcome(outcome: ConversionOutcome): IConversion
    {
        return { Outcome: outcome };
    }
}

/**
 * Compiles TODL policies (`policy <Concept> { allow|deny read|write when ... }`) into an engine
 * `AccessScope` for one principal, so the engine enforces them on every read and write. The compiled
 * scope mirrors the identity engine's evaluator: absent principal facts read as undefined, an unset
 * member never makes a leaf Unknown, and a leaf the engine cannot express compiles fail-closed (False in
 * an allow rule, True in a deny rule) and is reported on `Diagnostics`. A policy node that cannot be read
 * compiles its concept fail-closed (both actions False), also reported.
 */
export class PolicyScopeCompiler
{
    private static readonly MalformedMessage = 'policy "{0}" cannot be read ({1}); "{2}" is compiled fail-closed';
    private static readonly PolicySuffix = '@policy';
    private static readonly NoCause = 'no concept or rules';
    private static readonly NoConceptCause = 'no concept attribute; the concept is taken from the node id';
    private static readonly UnknownConceptMessage = 'policy concept "{0}" is not defined by the engine schema; its policy is not applied (the scope Default applies)';
    private static readonly Scalars: ReadonlyMap<ScalarBase, ValueType> = new Map<ScalarBase, ValueType>([
        [ScalarBase.String, ValueType.String],
        [ScalarBase.Number, ValueType.Float64],
        [ScalarBase.Integer, ValueType.Int64],
        [ScalarBase.Boolean, ValueType.Boolean],
    ]);

    private constructor(
        private readonly policies: ReadonlyMap<string, IConceptPolicy>,
        private readonly structural: readonly IPolicyDiagnostic[],
        private readonly semantics: PolicyValueSemantics)
    {
    }

    /**
     * What the engine cannot express in the policies, and which policy nodes could not be read. Structural: it
     * depends on the policies and the schema only, never on a principal. A snapshot copy.
     */
    public get Diagnostics(): readonly IPolicyDiagnostic[]
    {
        return [...this.structural];
    }

    /**
     * Reads every policy of `repo`. With `description` (the engine schema the scope will run under) each policied
     * concept and every member a rule reads is checked against it, as the engine's scope validation would:
     * a concept the schema lacks is reported and left to the scope Default, and a member the schema lacks (or has
     * as the other kind) makes its leaf fail-closed, so a compiled scope never makes the engine reject a read.
     */
    public static FromRepository(repo: Repository, description?: ISchemaDescription): PolicyScopeCompiler
    {
        const policies = new Map<string, IConceptPolicy>();
        const diagnostics: IPolicyDiagnostic[] = [];
        const schema = description === undefined ? undefined : new DescriptionMembers(description);
        for (const id of repo.nodesOfMetaKind(MetaKind.Policy))
        {
            const node = repo.resolve(id);
            const conceptAttr = node?.attrs.get(Builder.PolicyConceptAttr);
            const concept = String(conceptAttr ?? id.replace(PolicyScopeCompiler.PolicySuffix, ''));
            if (schema !== undefined && !schema.HasConcept(concept))
            {
                PolicyScopeCompiler.ReportUnknownConcept(concept, diagnostics);
                continue;
            }
            const members = schema !== undefined ? schema.Of(concept) : PolicyScopeCompiler.MembersOf(repo, concept);
            const raw = node?.attrs.get(Builder.PolicyRulesAttr);
            const json = conceptAttr !== undefined && raw !== undefined ? String(raw) : undefined;
            const absent = conceptAttr === undefined ? PolicyScopeCompiler.NoConceptCause : PolicyScopeCompiler.NoCause;
            policies.set(concept, { Rules: PolicyScopeCompiler.ReadRules(id, concept, json, absent, diagnostics), Members: members });
        }
        return PolicyScopeCompiler.Finish(policies, diagnostics, PolicyValueSemantics.SourceText);
    }

    /**
     * Reads runtime policies (`concept` + rules JSON, as `AccessPolicySetting.Load` yields them) against the engine
     * `description`. A repeated concept: the last entry wins. A concept the schema lacks is reported (`UnknownConcept`)
     * and left to the scope Default; rules that cannot be parsed compile the concept fail-closed (`MalformedPolicy`).
     * Values are typed: a JS number matches a numeric member and a string never does. Callers should treat any
     * `MalformedPolicy` as fatal for the app.
     */
    public static FromRules(rules: Iterable<IPolicyRuleSource>, description: ISchemaDescription): PolicyScopeCompiler
    {
        const latest = new Map<string, string>();
        for (const rule of rules)
        {
            latest.set(rule.concept, rule.rulesJson);
        }
        const schema = new DescriptionMembers(description);
        const policies = new Map<string, IConceptPolicy>();
        const diagnostics: IPolicyDiagnostic[] = [];
        for (const [concept, json] of latest)
        {
            if (!schema.HasConcept(concept))
            {
                PolicyScopeCompiler.ReportUnknownConcept(concept, diagnostics);
                continue;
            }
            policies.set(concept, { Rules: PolicyScopeCompiler.ReadRules(concept, concept, json, PolicyScopeCompiler.NoCause, diagnostics), Members: schema.Of(concept) });
        }
        return PolicyScopeCompiler.Finish(policies, diagnostics, PolicyValueSemantics.Typed);
    }

    private static ReportUnknownConcept(concept: string, diagnostics: IPolicyDiagnostic[]): void
    {
        diagnostics.push({ Code: PolicyDiagnosticCode.UnknownConcept, Concept: concept, Message: MessageFormat.Format(PolicyScopeCompiler.UnknownConceptMessage, concept) });
    }

    /**
     * The rules in `json`, or null (reported as `MalformedPolicy`, naming `label`) when there is no JSON (`absentCause`
     * says why) or it cannot be parsed.
     */
    private static ReadRules(label: string, concept: string, json: string | undefined, absentCause: string, diagnostics: IPolicyDiagnostic[]): readonly PolicyRule[] | null
    {
        let cause = absentCause;
        if (json !== undefined)
        {
            try
            {
                return PolicyRules.Parse(json);
            }
            catch (error)
            {
                cause = (error as Error).message;
            }
        }
        const message = MessageFormat.Format(PolicyScopeCompiler.MalformedMessage, label, cause, concept);
        diagnostics.push({ Code: PolicyDiagnosticCode.MalformedPolicy, Concept: concept, Message: message });
        return null;
    }

    private static Finish(policies: ReadonlyMap<string, IConceptPolicy>, diagnostics: IPolicyDiagnostic[], semantics: PolicyValueSemantics): PolicyScopeCompiler
    {
        const compiler = new PolicyScopeCompiler(policies, diagnostics, semantics);
        // Leaf diagnostics do not depend on the principal's facts: one pass with no facts collects them all.
        const noFacts: IPrincipalFacts = { Id: '', Get: () => undefined };
        compiler.Build(noFacts, diagnostics);
        return new PolicyScopeCompiler(policies, Object.freeze([...diagnostics]), semantics);
    }

    public Compile(principal: IPrincipalFacts, defaultAccess: AccessDefault): AccessScope
    {
        return this.Build(principal, []).Scope(defaultAccess);
    }

    /** How the engine sees each member of a policied concept (empty for a concept without a policy). */
    public MembersOf(concept: string): ReadonlyMap<string, IPolicyMember>
    {
        const out = new Map<string, IPolicyMember>();
        for (const [name, info] of this.policies.get(concept)?.Members ?? [])
        {
            out.set(name, { IsRelationship: info.Shape === MemberShape.Relationship, Type: info.Type });
        }
        return out;
    }

    private Build(principal: IPrincipalFacts, sink: IPolicyDiagnostic[]): ScopeParts
    {
        const rows = new Map<string, Predicate>();
        const writes = new Map<string, IWriteRules>();
        for (const [concept, policy] of this.policies)
        {
            if (policy.Rules === null)
            {
                rows.set(concept, FalsePredicate.Instance);
                writes.set(concept, { Create: FalsePredicate.Instance, Update: FalsePredicate.Instance, Delete: FalsePredicate.Instance });
                continue;
            }
            const terms = new TermCompiler(concept, policy.Members, principal, sink, this.semantics);
            rows.set(concept, PolicyScopeCompiler.Combine(policy.Rules, PolicyAction.Read, terms));
            const write = PolicyScopeCompiler.Combine(policy.Rules, PolicyAction.Write, terms);
            writes.set(concept, { Create: write, Update: write, Delete: write });
        }
        return new ScopeParts(rows, writes);
    }

    /** Or(allows) AND Not(Or(denies)); an action with no rules allows (as the evaluator does). */
    private static Combine(rules: readonly PolicyRule[], action: PolicyAction, terms: TermCompiler): Predicate
    {
        const forAction = rules.filter((r) => r.Action === action);
        const allows = forAction.filter((r) => r.Effect === PolicyEffect.Allow).map((r) => terms.Compile(r.Predicate, FalsePredicate.Instance));
        const denies = forAction.filter((r) => r.Effect === PolicyEffect.Deny).map((r) => terms.Compile(r.Predicate, TruePredicate.Instance));
        const allowed = allows.length === 0 ? TruePredicate.Instance : Fold.Or(allows);
        return denies.length === 0 ? allowed : Fold.And([allowed, Fold.Not(Fold.Or(denies))]);
    }

    /** How the engine sees each member of the concept, mirroring SnapshotDescriber's field mapping. */
    private static MembersOf(repo: Repository, concept: string): ReadonlyMap<string, IMemberInfo>
    {
        const out = new Map<string, IMemberInfo>();
        if (repo.resolve(concept) === undefined)
        {
            return out;
        }
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

/** The per-concept Rows and Writes of one compile, before they become an AccessScope. */
class ScopeParts
{
    public constructor(private readonly rows: ReadonlyMap<string, Predicate>, private readonly writes: ReadonlyMap<string, IWriteRules>)
    {
    }

    public Scope(defaultAccess: AccessDefault): AccessScope
    {
        return AccessScope.Build({ Default: defaultAccess, Rows: this.rows, Writes: this.writes });
    }
}
