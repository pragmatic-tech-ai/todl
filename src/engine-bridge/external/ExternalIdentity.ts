import { MemberKind, ValueType, type IDefinitionDescription, type ISchemaDescription, type MemberInput } from '@pragmatic-tech-ai/graph';
import type { ExternalFieldValue } from '../../model-data/connector-plan.js';
import { EngineBridgeError, EngineBridgeErrorCode } from '../EngineBridgeError.js';
import type { IExternalBinding, IParsedExternalId } from './ExternalBinding.js';

/**
 * Public ids and keys of external nodes (rulings T4, T6). A public id is `Concept#Connector.Source#StorageId`
 * (ConnectorMirrorMapper's shape); the storage id is everything after the second `#`, verbatim.
 */
export class ExternalIdentity
{
    private static readonly Separator = '#';
    private static readonly SourceSeparator = '.';
    private static readonly DecimalPattern = /^-?\d+(\.\d+)?$/;
    private static readonly ListSeparator = ', ';
    private static readonly ModelOpen = ' (model ';
    private static readonly ModelClose = ')';
    private static readonly ErrAmbiguous = 'More than one external binding fits concept ';
    private static readonly ErrBindings = ': ';

    private readonly definitions = new Map<string, IDefinitionDescription>();
    private readonly all: readonly IExternalBinding[];

    public constructor(description: ISchemaDescription, bindings: readonly IExternalBinding[])
    {
        for (const definition of description.Definitions)
        {
            this.definitions.set(definition.Name, definition);
        }
        this.all = bindings;
    }

    public Bindings(): readonly IExternalBinding[]
    {
        return this.all;
    }

    /** Bindings with `Writable: false` (the M2.3 write predicates). */
    public ReadOnly(): readonly IExternalBinding[]
    {
        return this.all.filter(b => !b.Binding.Writable);
    }

    public Mint(binding: IExternalBinding, storageId: string): string
    {
        return ExternalIdentity.Prefix(binding) + storageId;
    }

    /** The binding whose prefix is the longest match of `publicId`, with the rest as the storage id; undefined for a foreign id. */
    public Parse(publicId: string): IParsedExternalId | undefined
    {
        let best: IExternalBinding | undefined;
        let bestLength = -1;
        for (const binding of this.all)
        {
            const prefix = ExternalIdentity.Prefix(binding);
            if (publicId.startsWith(prefix) && prefix.length > bestLength)
            {
                best = binding;
                bestLength = prefix.length;
            }
        }
        return best === undefined ? undefined : { Binding: best, StorageId: publicId.slice(bestLength) };
    }

    /** The key sent to the adapter: a number for a numeric id member and decimal-text storage id, else the text. */
    public StorageKey(binding: IExternalBinding, storageId: string): ExternalFieldValue
    {
        const type = this.IdMemberType(binding);
        if (type === ValueType.Int64 || type === ValueType.Float64)
        {
            const value = Number(storageId);
            // Only canonical text round-trips: '007', '1.0' or a long float would change the id on the way out.
            const canonical = Number.isFinite(value) && String(value) === storageId;
            const exact = type === ValueType.Float64 ? canonical : canonical && ExternalIdentity.DecimalPattern.test(storageId) && Number.isSafeInteger(value);
            if (exact)
            {
                return value;
            }
        }
        return storageId;
    }

    /** The target id a foreign key on `relationship` points at; undefined when the target is ambiguous or the key null. */
    public LinkTarget(binding: IExternalBinding, relationship: string, foreignKey: ExternalFieldValue): string | undefined
    {
        if (foreignKey === null)
        {
            return undefined;
        }
        const candidates = this.TargetBindings(binding, relationship);
        if (candidates.length > 1)
        {
            return undefined;
        }
        return candidates.length === 1 ? this.Mint(candidates[0]!, String(foreignKey)) : String(foreignKey);
    }

    /** Inverse of LinkTarget: the parsed storage key when the target parses under the chosen binding, else the id itself. */
    public ForeignKey(binding: IExternalBinding, relationship: string, targetId: string): ExternalFieldValue
    {
        const candidates = this.TargetBindings(binding, relationship);
        if (candidates.length === 1)
        {
            const parsed = this.Parse(targetId);
            if (parsed !== undefined && parsed.Binding === candidates[0])
            {
                return this.StorageKey(parsed.Binding, parsed.StorageId);
            }
        }
        return targetId;
    }

    /** The one external binding of exactly `concept`; throws AmbiguousExternalBinding when several bind it. */
    public CreateTarget(concept: string): IExternalBinding | undefined
    {
        const matches = this.all.filter(b => b.Binding.Concept === concept);
        if (matches.length > 1)
        {
            const names = matches.map(b => b.Connector + ExternalIdentity.ModelOpen + b.Model + ExternalIdentity.ModelClose).join(ExternalIdentity.ListSeparator);
            throw new EngineBridgeError(EngineBridgeErrorCode.AmbiguousExternalBinding, ExternalIdentity.ErrAmbiguous + concept + ExternalIdentity.ErrBindings + names);
        }
        return matches[0];
    }

    private static Prefix(binding: IExternalBinding): string
    {
        return binding.Binding.Concept + ExternalIdentity.Separator + binding.Connector + ExternalIdentity.SourceSeparator
            + binding.Binding.Source + ExternalIdentity.Separator;
    }

    /** External bindings whose concept is a target of the relationship, or a subtype of one. */
    private TargetBindings(binding: IExternalBinding, relationship: string): IExternalBinding[]
    {
        const targets = this.FindMember(binding.Binding.Concept, relationship)?.Targets ?? [];
        return this.all.filter(b => targets.some(t => this.IsA(b.Binding.Concept, t)));
    }

    private IdMemberType(binding: IExternalBinding): ValueType | undefined
    {
        for (const [member, field] of Object.entries(binding.Binding.FieldMap))
        {
            if (field === binding.Binding.IdKey)
            {
                const input = this.FindMember(binding.Binding.Concept, member);
                return input?.Kind === MemberKind.Property ? input.Type : undefined;
            }
        }
        return undefined;
    }

    /** The member `name` declared on `concept` or anything it inherits or carries. */
    public FindMember(concept: string, name: string): MemberInput | undefined
    {
        return this.FindMemberIn(concept, name, new Set<string>());
    }

    private FindMemberIn(concept: string, name: string, seen: Set<string>): MemberInput | undefined
    {
        const definition = this.definitions.get(concept);
        if (definition === undefined || seen.has(concept))
        {
            return undefined;
        }
        seen.add(concept);
        const own = definition.Members.find(m => m.Name === name);
        if (own !== undefined)
        {
            return own;
        }
        for (const parent of ExternalIdentity.Supers(definition))
        {
            const found = this.FindMemberIn(parent, name, seen);
            if (found !== undefined)
            {
                return found;
            }
        }
        return undefined;
    }

    /** True when `concept` is `ancestor` or inherits or carries it. */
    private IsA(concept: string, ancestor: string): boolean
    {
        return this.IsAIn(concept, ancestor, new Set<string>());
    }

    private IsAIn(concept: string, ancestor: string, seen: Set<string>): boolean
    {
        if (concept === ancestor)
        {
            return true;
        }
        const definition = this.definitions.get(concept);
        if (definition === undefined || seen.has(concept))
        {
            return false;
        }
        seen.add(concept);
        return ExternalIdentity.Supers(definition).some(p => this.IsAIn(p, ancestor, seen));
    }

    private static Supers(definition: IDefinitionDescription): readonly string[]
    {
        return definition.Parent === null ? definition.Aspects : [definition.Parent, ...definition.Aspects];
    }
}
