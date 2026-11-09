import { createHash } from 'node:crypto';
import {
    MemberKind,
    ValueType,
    type CellValue,
    type IBindingDescription,
    type IDefinitionDescription,
    type ISchemaDescription,
    type ISeedLink,
    type ISeedNode,
    type MemberInput,
} from '@pragmatic-tech-ai/graph';
import type { MetadataSnapshot } from '../domain/metadata-snapshot.js';
import { Cardinality, MetaKind } from '../manifest/enums.js';
import type { Scalar } from '../manifest/logical.js';
import type { FieldInfo, ReflectedNode, RelationshipInfo, TermInfo, TypeInfo } from '../manifest/reflection/reflection.js';
import { EngineBridgeError, EngineBridgeErrorCode } from './EngineBridgeError.js';
import { DescribeDiagnosticCode, type IDescribeDiagnostic, type IDescribeOptions, type ISnapshotDescription } from './SnapshotDescription.js';
import { TodlNames } from './TodlNames.js';

/** Where a member's seed value comes from on a TODL heap node. */
enum MemberSource
{
    /** A reserved bridge member (`class`, `taxonomy`) filled by the describer itself. */
    Reserved = 1,
    /** A scalar field: the reflected (class-flattened, instance-wins) attr value. */
    Scalar,
    /** A single-card taxonomy-typed field: the term id held in the node's refs. */
    TaxonomyTerm,
    /** A relationship (or concept / many-card taxonomy field): the node's refs, as links. */
    Link,
}

interface IMemberPlan
{
    readonly Input: MemberInput;
    readonly Source: MemberSource;
}

/** One definition before its members are reconciled against what it inherits. */
interface IDefinitionDraft
{
    readonly Name: string;
    readonly IsAspect: boolean;
    Parent: string | null;
    Aspects: string[];
    readonly Own: readonly IMemberPlan[];
}

/** The outcome of converting one TODL scalar to an engine cell: a value, or why it was skipped. */
interface IConversion
{
    readonly Value?: CellValue;
    readonly Failure?: DescribeDiagnosticCode;
}

/** TODL scalar → engine cell conversion per value type. TODL keeps numeric literals as decimal strings. */
class CellConverter
{
    private static readonly IntegerPattern = /^[+-]?\d+$/;

    public static Convert(type: ValueType | undefined, raw: Scalar): IConversion
    {
        switch (type)
        {
            case ValueType.String:
                return typeof raw === 'string' ? { Value: raw } : CellConverter.Fail(DescribeDiagnosticCode.ValueTypeMismatch);
            case ValueType.Boolean:
                return typeof raw === 'boolean' ? { Value: raw } : CellConverter.Fail(DescribeDiagnosticCode.ValueTypeMismatch);
            case ValueType.Float64:
                return CellConverter.ToFloat(raw);
            case ValueType.Int64:
                return CellConverter.ToInteger(raw);
            default:
                return CellConverter.Fail(DescribeDiagnosticCode.ValueTypeMismatch);
        }
    }

    private static ToFloat(raw: Scalar): IConversion
    {
        const value = CellConverter.Numeric(raw);
        return value === undefined ? CellConverter.Fail(DescribeDiagnosticCode.ValueTypeMismatch) : { Value: value };
    }

    private static ToInteger(raw: Scalar): IConversion
    {
        if (typeof raw === 'string' && CellConverter.IntegerPattern.test(raw.trim()))
        {
            return { Value: BigInt(raw.trim()) };
        }
        const value = CellConverter.Numeric(raw);
        if (value === undefined)
        {
            return CellConverter.Fail(DescribeDiagnosticCode.ValueTypeMismatch);
        }
        return Number.isInteger(value) ? { Value: BigInt(value) } : CellConverter.Fail(DescribeDiagnosticCode.NonIntegralInteger);
    }

    /** A finite number from a JS number or a numeric string; undefined otherwise. */
    private static Numeric(raw: Scalar): number | undefined
    {
        if (typeof raw === 'number')
        {
            return Number.isFinite(raw) ? raw : undefined;
        }
        if (typeof raw !== 'string' || raw.trim().length === 0)
        {
            return undefined;
        }
        const value = Number(raw);
        return Number.isFinite(value) ? value : undefined;
    }

    private static Fail(code: DescribeDiagnosticCode): IConversion
    {
        return { Failure: code };
    }
}

/**
 * Canonical JSON for the content version: object keys sorted, arrays in order, bigint as a decimal string, engine
 * value classes (DateValue, …) by their fields, undefined members omitted.
 */
class CanonicalJson
{
    private static readonly Null = 'null';

    public static Stringify(value: unknown): string
    {
        if (value === null || value === undefined)
        {
            return CanonicalJson.Null;
        }
        if (typeof value === 'bigint')
        {
            return JSON.stringify(value.toString());
        }
        if (typeof value !== 'object')
        {
            return JSON.stringify(value);
        }
        if (Array.isArray(value))
        {
            return `[${value.map((item) => CanonicalJson.Stringify(item)).join(',')}]`;
        }
        const record = value as Record<string, unknown>;
        const members = Object.keys(record)
            .filter((key) => record[key] !== undefined)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${CanonicalJson.Stringify(record[key])}`);
        return `{${members.join(',')}}`;
    }
}

/**
 * Turns a compiled TODL metadata snapshot into the graph engine's schema description: one definition per concept and
 * aspect under the reserved `todl.Element` root, `todl.Term` for taxonomy terms, a seed node per heap node and term,
 * the `.todl` connector bindings, and a content-derived version. Problems in the data become diagnostics, never
 * exceptions; only a field type with no engine value type throws (`UnsupportedFieldType`).
 *
 * Seed `Owner` is the package model id (`PackageRef.model`, e.g. `shop.p`) of the package whose BindSeed bound the
 * node (`MetadataSnapshot.OriginModelOf`, the model part of `originOf`); a term's Owner is the model of the first
 * manifest (deps-first) declaring its taxonomy.
 */
export class SnapshotDescriber
{
    private static readonly HashAlgorithm = 'sha256';
    private static readonly HexEncoding = 'hex';
    private static readonly MemberSeparator = '.';
    private static readonly UnresolvedType = '<unresolved>';
    private static readonly NoOwner = '';
    private static readonly NoVersion = '';
    private static readonly MissingArgument = '';
    private static readonly Placeholder = /\{(\d+)\}/g;
    private static readonly UnsupportedFieldMessage = 'Field "{0}" has type "{1}", which has no engine value type';
    private static readonly RedeclaredMessage = '"{0}" redeclares "{1}" differently from the member it inherits; the inherited member is used';
    private static readonly UnknownConceptMessage = '"{0}" has type "{1}", which is not a described concept';
    private static readonly ExtraTermsMessage = '"{0}" holds one term but "{1}" names {2}; only "{3}" is kept';
    private static readonly MismatchMessage = '"{0}" does not fit "{1}" ({2}); skipped';
    private static readonly UnknownPropertyMessage = '"{0}" is not a property of "{1}"; skipped';
    private static readonly UnknownRelationshipMessage = '"{0}" is not a relationship of "{1}"; its links are dropped';
    private static readonly DanglingMessage = 'link to "{0}" dropped: no such node in the snapshot';
    private static readonly Builtins: ReadonlyMap<string, ValueType> = new Map<string, ValueType>([
        ['string', ValueType.String],
        ['number', ValueType.Float64],
        ['integer', ValueType.Int64],
        ['boolean', ValueType.Boolean],
    ]);

    private readonly drafts = new Map<string, IDefinitionDraft>();
    private readonly effective = new Map<string, Map<string, IMemberPlan>>();
    private readonly members = new Map<string, MemberInput[]>();
    private readonly resolving = new Set<string>();
    private readonly taxonomyNames = new Set<string>();
    private readonly diagnostics: IDescribeDiagnostic[] = [];

    private constructor(private readonly snapshot: MetadataSnapshot, private readonly options: IDescribeOptions) {}

    public static Describe(snapshot: MetadataSnapshot, options: IDescribeOptions): ISnapshotDescription
    {
        return new SnapshotDescriber(snapshot, options).Run();
    }

    private Run(): ISnapshotDescription
    {
        for (const manifest of this.snapshot.manifests)
        {
            for (const taxonomy of manifest.taxonomies())
            {
                this.taxonomyNames.add(taxonomy.name);
            }
        }
        this.DraftDefinitions();
        const definitions = [...this.drafts.values()].map((draft) => this.Finish(draft));
        const seed = this.DescribeSeed();
        const external = new Set<string>();
        const bindings = this.DescribeBindings(external);
        const unversioned: ISchemaDescription = {
            Version: SnapshotDescriber.NoVersion,
            Definitions: definitions,
            Indexes: [],
            Seed: seed,
            Bindings: bindings,
            DefaultConnector: this.options.DefaultConnector,
        };
        const version = createHash(SnapshotDescriber.HashAlgorithm)
            .update(CanonicalJson.Stringify(unversioned))
            .digest(SnapshotDescriber.HexEncoding);
        return { Description: { ...unversioned, Version: version }, External: external, Diagnostics: this.diagnostics };
    }

    // ── definitions ────────────────────────────────────────────────────────

    private DraftDefinitions(): void
    {
        const root = this.FindType(TodlNames.Element);
        const rootOwn: IMemberPlan[] = root === undefined ? [] : this.OwnMembers(root);
        if (!rootOwn.some((m) => m.Input.Name === TodlNames.Label))
        {
            rootOwn.unshift(SnapshotDescriber.Property(TodlNames.Label, ValueType.String, MemberSource.Scalar));
        }
        rootOwn.push(SnapshotDescriber.Property(TodlNames.Class, ValueType.String, MemberSource.Reserved));
        this.drafts.set(TodlNames.Element, { Name: TodlNames.Element, IsAspect: false, Parent: null, Aspects: [], Own: rootOwn });
        this.drafts.set(TodlNames.Term, {
            Name: TodlNames.Term, IsAspect: false, Parent: TodlNames.Element, Aspects: [],
            Own: [
                SnapshotDescriber.Property(TodlNames.Taxonomy, ValueType.String, MemberSource.Reserved),
                SnapshotDescriber.Relationship(TodlNames.Broader, [TodlNames.Term], true),
            ],
        });
        for (const manifest of this.snapshot.manifests)
        {
            for (const type of manifest.types())
            {
                if ((type.kind !== MetaKind.Concept && type.kind !== MetaKind.Aspect) || this.drafts.has(type.fullName)) continue;
                const base = type.isAspect ? null : type.baseType?.fullName ?? null;
                this.drafts.set(type.fullName, {
                    Name: type.fullName,
                    IsAspect: type.isAspect,
                    Parent: type.isAspect ? null : base ?? TodlNames.Element,
                    Aspects: type.getDeclaredAspects().map((a) => a.fullName),
                    Own: this.OwnMembers(type),
                });
            }
        }
        // A parent or aspect that is not itself described (an unresolved cross-manifest ref) falls back to the root.
        for (const draft of this.drafts.values())
        {
            if (draft.Parent !== null && this.drafts.get(draft.Parent)?.IsAspect !== false) draft.Parent = TodlNames.Element;
            draft.Aspects = draft.Aspects.filter((a) => this.drafts.get(a)?.IsAspect === true);
        }
    }

    /** The first type (deps-first) with this full name that is a concept. */
    private FindType(fullName: string): TypeInfo | undefined
    {
        for (const manifest of this.snapshot.manifests)
        {
            const type = manifest.types().find((t) => t.fullName === fullName && t.kind === MetaKind.Concept);
            if (type !== undefined) return type;
        }
        return undefined;
    }

    private OwnMembers(type: TypeInfo): IMemberPlan[]
    {
        return [
            ...type.getDeclaredFields().map((f) => this.FieldMember(type, f)),
            ...type.getDeclaredRelationships().map((r) => this.RelationshipMember(r)),
        ];
    }

    private FieldMember(owner: TypeInfo, field: FieldInfo): IMemberPlan
    {
        const type = field.fieldType;
        const many = SnapshotDescriber.IsMany(field.cardinality);
        if (type !== undefined)
        {
            if (type.kind === MetaKind.Concept || type.kind === MetaKind.Aspect)
            {
                return SnapshotDescriber.Relationship(field.name, [type.fullName], many);
            }
            if (type.kind === MetaKind.Taxonomy || (type.kind === MetaKind.Primitive && this.taxonomyNames.has(type.fullName)))
            {
                return many
                    ? SnapshotDescriber.Relationship(field.name, [TodlNames.Term], true)
                    : SnapshotDescriber.Property(field.name, ValueType.String, MemberSource.TaxonomyTerm);
            }
            if (type.kind === MetaKind.Primitive)
            {
                return SnapshotDescriber.Property(field.name, SnapshotDescriber.ScalarTypeOf(type), MemberSource.Scalar);
            }
        }
        const typeName = type?.fullName ?? SnapshotDescriber.UnresolvedType;
        throw new EngineBridgeError(EngineBridgeErrorCode.UnsupportedFieldType,
            SnapshotDescriber.Format(SnapshotDescriber.UnsupportedFieldMessage, `${owner.fullName}${SnapshotDescriber.MemberSeparator}${field.name}`, typeName));
    }

    /** The builtin a primitive's base chain ends at; an opaque (base-less) primitive or a cyclic chain is a String. */
    private static ScalarTypeOf(primitive: TypeInfo): ValueType
    {
        const seen = new Set<string>();
        let current: TypeInfo | undefined = primitive;
        while (current !== undefined && !seen.has(current.fullName))
        {
            const builtin = SnapshotDescriber.Builtins.get(current.fullName);
            if (builtin !== undefined) return builtin;
            seen.add(current.fullName);
            current = current.baseType;
        }
        return ValueType.String;
    }

    private RelationshipMember(rel: RelationshipInfo): IMemberPlan
    {
        const targets: string[] = [];
        for (const target of rel.targets)
        {
            const name = target.kind === MetaKind.Concept || target.kind === MetaKind.Aspect
                ? target.fullName
                : this.taxonomyNames.has(target.fullName) || target.kind === MetaKind.Taxonomy ? TodlNames.Term : undefined;
            if (name !== undefined && !targets.includes(name)) targets.push(name);
        }
        // No describable target (unresolved): any element may be linked rather than refusing to open.
        return SnapshotDescriber.Relationship(rel.name, targets.length > 0 ? targets : [TodlNames.Element], SnapshotDescriber.IsMany(rel.cardinality));
    }

    private static IsMany(card: Cardinality): boolean
    {
        return card === Cardinality.Many || card === Cardinality.OneOrMore;
    }

    private static Property(name: string, type: ValueType, source: MemberSource): IMemberPlan
    {
        return { Input: { Name: name, Kind: MemberKind.Property, Type: type, Nullable: true }, Source: source };
    }

    private static Relationship(name: string, targets: string[], many: boolean): IMemberPlan
    {
        const input: MemberInput = many
            ? { Name: name, Kind: MemberKind.Relationship, Targets: targets, Many: true, Ordered: true }
            : { Name: name, Kind: MemberKind.Relationship, Targets: targets, Many: false };
        return { Input: input, Source: MemberSource.Link };
    }

    private Finish(draft: IDefinitionDraft): IDefinitionDescription
    {
        this.Effective(draft.Name);
        return {
            Name: draft.Name,
            IsAspect: draft.IsAspect,
            Parent: draft.Parent,
            Aspects: draft.Aspects,
            Members: this.members.get(draft.Name) ?? [],
        };
    }

    /**
     * Every member the engine gives `name` (inherited, carried, own), memoized. An own member whose name is already
     * provided (by the parent chain, a carried aspect or, for an aspect, the root every carrier descends from) is
     * dropped, since the engine refuses a redeclaration; silently when it agrees, else with MemberRedeclared.
     */
    private Effective(name: string): Map<string, IMemberPlan>
    {
        const cached = this.effective.get(name);
        if (cached !== undefined) return cached;
        const draft = this.drafts.get(name);
        if (draft === undefined || this.resolving.has(name)) return new Map();
        this.resolving.add(name);
        const provided = new Map<string, IMemberPlan>();
        const inherit = (from: string): void =>
        {
            for (const [member, plan] of this.Effective(from)) if (!provided.has(member)) provided.set(member, plan);
        };
        if (draft.Parent !== null) inherit(draft.Parent);
        else if (draft.IsAspect) inherit(TodlNames.Element);
        for (const aspect of draft.Aspects) inherit(aspect);
        const kept: MemberInput[] = [];
        for (const plan of draft.Own)
        {
            const existing = provided.get(plan.Input.Name);
            if (existing === undefined)
            {
                provided.set(plan.Input.Name, plan);
                kept.push(plan.Input);
            }
            else if (!SnapshotDescriber.Agree(existing, plan))
            {
                this.Report(DescribeDiagnosticCode.MemberRedeclared, `${name}${SnapshotDescriber.MemberSeparator}${plan.Input.Name}`,
                    SnapshotDescriber.Format(SnapshotDescriber.RedeclaredMessage, name, plan.Input.Name));
            }
        }
        this.resolving.delete(name);
        this.members.set(name, kept);
        this.effective.set(name, provided);
        return provided;
    }

    private static Agree(a: IMemberPlan, b: IMemberPlan): boolean
    {
        if (a.Source !== b.Source || a.Input.Kind !== b.Input.Kind) return false;
        if (a.Input.Kind === MemberKind.Property) return a.Input.Type === b.Input.Type;
        const left = [...(a.Input.Targets ?? [])].sort();
        const right = [...(b.Input.Targets ?? [])].sort();
        return a.Input.Many === b.Input.Many && left.length === right.length && left.every((t, i) => t === right[i]);
    }

    // ── seed ───────────────────────────────────────────────────────────────

    private DescribeSeed(): ISeedNode[]
    {
        const nodes: ReflectedNode[] = [];
        for (const node of this.snapshot.allNodes())
        {
            const draft = this.drafts.get(node.type);
            if (draft === undefined || draft.IsAspect || node.type === TodlNames.Term)
            {
                this.Report(DescribeDiagnosticCode.UnknownConcept, node.id, SnapshotDescriber.Format(SnapshotDescriber.UnknownConceptMessage, node.id, node.type));
                continue;
            }
            nodes.push(node);
        }
        const terms = this.DescribeTerms();
        const seeded = new Set<string>([...nodes.map((n) => n.id), ...terms.map((t) => t.PublicId)]);
        return [...nodes.map((node) => this.DescribeNode(node, seeded)), ...terms];
    }

    private DescribeNode(node: ReflectedNode, seeded: ReadonlySet<string>): ISeedNode
    {
        const plans = this.Effective(node.type);
        const mirror = this.snapshot.reflect(node);
        const properties: Record<string, CellValue> = { [TodlNames.Label]: null, [TodlNames.Class]: node.class ?? null };
        for (const [name, plan] of plans)
        {
            let raw: Scalar | undefined;
            if (plan.Source === MemberSource.Scalar)
            {
                raw = mirror.field(name)?.value ?? node.attrs[name];
            }
            else if (plan.Source === MemberSource.TaxonomyTerm)
            {
                const terms = node.refs?.[name] ?? [];
                raw = terms[0] ?? node.attrs[name];
                if (terms.length > 1)
                {
                    this.Report(DescribeDiagnosticCode.ValueTypeMismatch, this.Subject(node, name),
                        SnapshotDescriber.Format(SnapshotDescriber.ExtraTermsMessage, name, node.id, String(terms.length), terms[0]!));
                }
            }
            if (raw === undefined) continue;
            const converted = CellConverter.Convert(plan.Input.Type, raw);
            if (converted.Failure !== undefined)
            {
                this.Report(converted.Failure, this.Subject(node, name), SnapshotDescriber.Format(SnapshotDescriber.MismatchMessage, String(raw), name, ValueType[plan.Input.Type!]));
                continue;
            }
            properties[name] = converted.Value!;
        }
        for (const name of Object.keys(node.attrs))
        {
            const plan = plans.get(name);
            if (plan === undefined || plan.Source === MemberSource.Link || plan.Source === MemberSource.Reserved)
            {
                this.Report(DescribeDiagnosticCode.UnknownMember, this.Subject(node, name), SnapshotDescriber.Format(SnapshotDescriber.UnknownPropertyMessage, name, node.type));
            }
        }
        const links: ISeedLink[] = [];
        for (const [rel, targets] of Object.entries(node.refs ?? {}))
        {
            const plan = plans.get(rel);
            if (plan?.Source === MemberSource.TaxonomyTerm) continue;
            if (plan?.Source !== MemberSource.Link)
            {
                this.Report(DescribeDiagnosticCode.UnknownMember, this.Subject(node, rel), SnapshotDescriber.Format(SnapshotDescriber.UnknownRelationshipMessage, rel, node.type));
                continue;
            }
            for (const to of targets)
            {
                if (seeded.has(to))
                {
                    links.push({ Relationship: rel, To: to });
                }
                else
                {
                    this.Report(DescribeDiagnosticCode.DanglingLink, this.Subject(node, rel), SnapshotDescriber.Format(SnapshotDescriber.DanglingMessage, to));
                }
            }
        }
        return {
            PublicId: node.id,
            Concept: node.type,
            Owner: this.snapshot.OriginModelOf(node.id) ?? this.snapshot.ownerOf(node.type)?.model ?? SnapshotDescriber.NoOwner,
            Properties: properties,
            Links: links,
        };
    }

    /** Every taxonomy term as a `todl.Term` seed node, first declaration (deps-first) wins. */
    private DescribeTerms(): ISeedNode[]
    {
        const out: ISeedNode[] = [];
        const seen = new Set<string>();
        const plans = this.Effective(TodlNames.Term);
        for (const manifest of this.snapshot.manifests)
        {
            for (const taxonomy of manifest.taxonomies())
            {
                for (const term of taxonomy.getTerms())
                {
                    if (seen.has(term.id)) continue;
                    seen.add(term.id);
                    const properties: Record<string, CellValue> = { [TodlNames.Label]: null, [TodlNames.Class]: null, [TodlNames.Taxonomy]: taxonomy.name };
                    for (const [name, plan] of plans)
                    {
                        if (plan.Source !== MemberSource.Scalar) continue;
                        const raw = SnapshotDescriber.FixedValue(term, name);
                        const converted = raw === undefined ? undefined : CellConverter.Convert(plan.Input.Type, raw);
                        if (converted?.Value !== undefined) properties[name] = converted.Value;
                    }
                    const broader = term.broader;
                    out.push({
                        PublicId: term.id,
                        Concept: TodlNames.Term,
                        Owner: manifest.model,
                        Properties: properties,
                        Links: broader === undefined ? [] : [{ Relationship: TodlNames.Broader, To: broader.id }],
                    });
                }
            }
        }
        return out;
    }

    /** The value a term pins itself (not through its broader chain) for the field `name` of its concept. */
    private static FixedValue(term: TermInfo, name: string): Scalar | undefined
    {
        const field = term.concept?.getField(name);
        return field === undefined ? undefined : term.getFixedValue(field);
    }

    private Subject(node: ReflectedNode, member: string): string
    {
        return `${node.id}${SnapshotDescriber.MemberSeparator}${member}`;
    }

    /** `template` with each `{n}` replaced by `args[n]`. */
    private static Format(template: string, ...args: string[]): string
    {
        return template.replace(SnapshotDescriber.Placeholder, (_, index: string) => args[Number(index)] ?? SnapshotDescriber.MissingArgument);
    }

    private Report(code: DescribeDiagnosticCode, subject: string, message: string): void
    {
        this.diagnostics.push({ Code: code, Subject: subject, Message: message });
    }

    // ── bindings ───────────────────────────────────────────────────────────

    private DescribeBindings(external: Set<string>): IBindingDescription[]
    {
        const out: IBindingDescription[] = [];
        for (const plan of this.options.ConnectorPlans ?? [])
        {
            for (const binding of plan.Bindings)
            {
                if (binding.Connector === TodlNames.FileConnector)
                {
                    out.push({ Model: plan.Model, Concept: binding.Concept, Connector: binding.Connector });
                }
                else
                {
                    external.add(binding.Concept);
                }
            }
        }
        return out;
    }
}
