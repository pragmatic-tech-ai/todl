import { CompareOp, MemberKind, PredicateKind, ValueType, type And, type CellValue, type Compare, type IdIn, type In, type IsNull, type Not, type Predicate } from '@pragmatic-tech-ai/graph';
import { QueryCompareOp, type ExternalFieldValue, type QueryComparison, type QueryFilter } from '../../model-data/connector-plan.js';
import type { IExternalBinding } from './ExternalBinding.js';
import type { ExternalIdentity } from './ExternalIdentity.js';

/** A field-mapped, typed property member of a binding: its source field and engine type. */
export interface IMappedProperty
{
    readonly Field: string;
    readonly Type: ValueType;
}

/**
 * Which FieldMap entries of a binding a connector reads (ruling T5): typed property members, and single-valued
 * relationships (a many-valued relationship or an untyped property in a FieldMap is unmapped). The single home of that
 * rule, shared by the reader (DataSourceConnector) and push-down (FetchTranslator) so they always agree. Module-internal:
 * not exported from the engine entry.
 */
export class MappedMembers
{
    public static Property(binding: IExternalBinding, member: string, identity: ExternalIdentity): IMappedProperty | undefined
    {
        const field = MappedMembers.FieldOf(binding, member);
        if (field === undefined)
        {
            return undefined;
        }
        const input = identity.FindMember(binding.Binding.Concept, member);
        return input?.Kind === MemberKind.Property && input.Type !== undefined ? { Field: field, Type: input.Type } : undefined;
    }

    /** The foreign-key field of a mapped single-valued relationship. */
    public static Link(binding: IExternalBinding, relationship: string, identity: ExternalIdentity): string | undefined
    {
        const field = MappedMembers.FieldOf(binding, relationship);
        if (field === undefined)
        {
            return undefined;
        }
        const input = identity.FindMember(binding.Binding.Concept, relationship);
        return input?.Kind === MemberKind.Relationship && input.Many !== true ? field : undefined;
    }

    private static FieldOf(binding: IExternalBinding, member: string): string | undefined
    {
        return Object.hasOwn(binding.Binding.FieldMap, member) ? binding.Binding.FieldMap[member] : undefined;
    }
}

/**
 * Advisory push-down of a fetch (rulings T7, P10; D4). Only the top-level conjuncts of the request predicate translate,
 * and a conjunct that does not translate is dropped: the engine re-checks every returned row, so a pushed term may only
 * exclude rows the engine would exclude too. That holds only where the source compares the very value the engine sees:
 * - `Compare` with `Eq`, and `In`, on String or Boolean property members (CellConverter keeps those values as they are,
 *   and a source collation can only widen equality, never narrow it). Ordering (`Ne`, `Lt`, `Le`, `Gt`, `Ge`) is never
 *   pushed, since source ordering and inequality under a collation can exclude rows the engine admits. A Compare or In on
 *   an Int64, Float64 or temporal member is never pushed: CellConverter reads numeric members from text (`'012'` is
 *   12n), so a source comparison on the raw field could exclude a row the engine admits.
 * - `IsNull` and `Not(IsNull)` on typed property members (external null is null, anything else converts or fails).
 * - `IdIn`: `in` on IdKey over the ids that parse under the binding (an empty `in` when none parses).
 * A relationship member, a many-valued relationship or an untyped property is unmapped (T5) and never pushed.
 */
export class FetchTranslator
{
    /** The translated top-level conjuncts of `predicate`; undefined when none translates. */
    public static Where(binding: IExternalBinding, predicate: Predicate, identity: ExternalIdentity): QueryFilter | undefined
    {
        const conjuncts = predicate.Kind === PredicateKind.And ? (predicate as And).Terms : [predicate];
        const all: QueryComparison[] = [];
        for (const conjunct of conjuncts)
        {
            const term = FetchTranslator.Term(binding, conjunct, identity);
            if (term !== undefined)
            {
                all.push(term);
            }
        }
        return all.length === 0 ? undefined : { All: all };
    }

    private static Term(binding: IExternalBinding, predicate: Predicate, identity: ExternalIdentity): QueryComparison | undefined
    {
        switch (predicate.Kind)
        {
            case PredicateKind.Compare:
                return FetchTranslator.EqTerm(binding, predicate as Compare, identity);
            case PredicateKind.In:
                return FetchTranslator.MemberIn(binding, predicate as In, identity);
            case PredicateKind.IsNull:
                return FetchTranslator.NullTerm(binding, (predicate as IsNull).Member, QueryCompareOp.IsNull, identity);
            case PredicateKind.Not:
            {
                const inner = (predicate as Not).Term;
                return inner.Kind === PredicateKind.IsNull
                    ? FetchTranslator.NullTerm(binding, (inner as IsNull).Member, QueryCompareOp.IsNotNull, identity)
                    : undefined;
            }
            case PredicateKind.IdIn:
                return FetchTranslator.IdTerm(binding, (predicate as IdIn).Ids, identity);
            default:
                return undefined;
        }
    }

    private static EqTerm(binding: IExternalBinding, compare: Compare, identity: ExternalIdentity): QueryComparison | undefined
    {
        const field = FetchTranslator.ExactField(binding, compare.Member, identity);
        const value = FetchTranslator.Value(compare.Value);
        if (compare.Op !== CompareOp.Eq || field === undefined || value === undefined)
        {
            return undefined;
        }
        return { Field: field, Op: QueryCompareOp.Eq, Value: value };
    }

    private static MemberIn(binding: IExternalBinding, membership: In, identity: ExternalIdentity): QueryComparison | undefined
    {
        const field = FetchTranslator.ExactField(binding, membership.Member, identity);
        if (field === undefined)
        {
            return undefined;
        }
        const values: ExternalFieldValue[] = [];
        for (const cell of membership.Values)
        {
            const value = FetchTranslator.Value(cell);
            if (value === undefined)
            {
                return undefined;
            }
            values.push(value);
        }
        return FetchTranslator.InTerm(field, values);
    }

    private static NullTerm(binding: IExternalBinding, member: string, op: QueryCompareOp, identity: ExternalIdentity): QueryComparison | undefined
    {
        const field = MappedMembers.Property(binding, member, identity)?.Field;
        return field === undefined ? undefined : { Field: field, Op: op, Value: null };
    }

    /** `in` on IdKey over the storage keys of the ids that parse under `binding`; ids of other bindings or the engine are skipped. */
    private static IdTerm(binding: IExternalBinding, ids: ReadonlySet<string>, identity: ExternalIdentity): QueryComparison
    {
        const keys: ExternalFieldValue[] = [];
        for (const id of ids)
        {
            const parsed = identity.Parse(id);
            if (parsed !== undefined && parsed.Binding === binding)
            {
                keys.push(identity.StorageKey(binding, parsed.StorageId));
            }
        }
        return FetchTranslator.InTerm(binding.Binding.IdKey, keys);
    }

    private static InTerm(field: string, values: readonly ExternalFieldValue[]): QueryComparison
    {
        return { Field: field, Op: QueryCompareOp.In, Value: null, Values: values };
    }

    /** The field of a mapped String or Boolean property: the only members whose source value equals the engine value. */
    private static ExactField(binding: IExternalBinding, member: string, identity: ExternalIdentity): string | undefined
    {
        const property = MappedMembers.Property(binding, member, identity);
        return property !== undefined && (property.Type === ValueType.String || property.Type === ValueType.Boolean) ? property.Field : undefined;
    }

    /** A cell as an external operand: a safe bigint is a number; an unsafe bigint or a temporal cell does not translate. */
    private static Value(cell: CellValue): ExternalFieldValue | undefined
    {
        if (typeof cell === 'bigint')
        {
            const value = Number(cell);
            return Number.isSafeInteger(value) ? value : undefined;
        }
        if (cell === null || typeof cell === 'string' || typeof cell === 'number' || typeof cell === 'boolean')
        {
            return cell;
        }
        return undefined;
    }
}
