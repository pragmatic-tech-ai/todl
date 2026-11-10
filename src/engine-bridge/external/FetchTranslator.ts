import { CompareOp, PredicateKind, type And, type CellValue, type Compare, type IdIn, type In, type IsNull, type Not, type Predicate } from '@pragmatic-tech-ai/graph';
import { QueryCompareOp, type ExternalFieldValue, type QueryComparison, type QueryFilter } from '../../model-data/connector-plan.js';
import type { IExternalBinding } from './ExternalBinding.js';
import type { ExternalIdentity } from './ExternalIdentity.js';

/**
 * Advisory push-down of a fetch (ruling T7, D4). Only the top-level conjuncts of the request predicate translate, and
 * a conjunct that does not translate is dropped: the engine re-checks every returned row, so each term only has to
 * exclude rows the engine would exclude too (SQL NULL semantics are no more permissive than Kleene at an And top).
 */
export class FetchTranslator
{
    private static readonly Ops: ReadonlyMap<CompareOp, QueryCompareOp> = new Map([
        [CompareOp.Eq, QueryCompareOp.Eq],
        [CompareOp.Ne, QueryCompareOp.Neq],
        [CompareOp.Lt, QueryCompareOp.Lt],
        [CompareOp.Le, QueryCompareOp.Lte],
        [CompareOp.Gt, QueryCompareOp.Gt],
        [CompareOp.Ge, QueryCompareOp.Gte],
    ]);

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

    /** `in` on IdKey over the keys minted by `binding`; undefined when none is (the page is then empty). */
    public static Keys(binding: IExternalBinding, keys: readonly string[], identity: ExternalIdentity): QueryComparison | undefined
    {
        const values = FetchTranslator.StorageKeys(binding, keys, identity);
        return values.length === 0 ? undefined : FetchTranslator.InTerm(binding.Binding.IdKey, values);
    }

    /** `eq` on the foreign-key field of `relationship` with the key of `target` (T6). */
    public static Reverse(binding: IExternalBinding, relationship: string, field: string, target: string, identity: ExternalIdentity): QueryComparison
    {
        return { Field: field, Op: QueryCompareOp.Eq, Value: identity.ForeignKey(binding, relationship, target) };
    }

    private static Term(binding: IExternalBinding, predicate: Predicate, identity: ExternalIdentity): QueryComparison | undefined
    {
        switch (predicate.Kind)
        {
            case PredicateKind.Compare:
                return FetchTranslator.CompareTerm(binding, predicate as Compare);
            case PredicateKind.In:
                return FetchTranslator.MemberIn(binding, predicate as In);
            case PredicateKind.IsNull:
                return FetchTranslator.NullTerm(binding, (predicate as IsNull).Member, QueryCompareOp.IsNull);
            case PredicateKind.Not:
            {
                const inner = (predicate as Not).Term;
                return inner.Kind === PredicateKind.IsNull
                    ? FetchTranslator.NullTerm(binding, (inner as IsNull).Member, QueryCompareOp.IsNotNull)
                    : undefined;
            }
            case PredicateKind.IdIn:
                return FetchTranslator.InTerm(binding.Binding.IdKey, FetchTranslator.StorageKeys(binding, [...(predicate as IdIn).Ids], identity));
            default:
                return undefined;
        }
    }

    private static CompareTerm(binding: IExternalBinding, compare: Compare): QueryComparison | undefined
    {
        const field = FetchTranslator.Field(binding, compare.Member);
        const value = FetchTranslator.Value(compare.Value);
        const op = FetchTranslator.Ops.get(compare.Op);
        if (field === undefined || value === undefined || op === undefined)
        {
            return undefined;
        }
        return { Field: field, Op: op, Value: value };
    }

    private static MemberIn(binding: IExternalBinding, membership: In): QueryComparison | undefined
    {
        const field = FetchTranslator.Field(binding, membership.Member);
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

    private static NullTerm(binding: IExternalBinding, member: string, op: QueryCompareOp): QueryComparison | undefined
    {
        const field = FetchTranslator.Field(binding, member);
        return field === undefined ? undefined : { Field: field, Op: op, Value: null };
    }

    private static InTerm(field: string, values: readonly ExternalFieldValue[]): QueryComparison
    {
        return { Field: field, Op: QueryCompareOp.In, Value: null, Values: values };
    }

    /** The storage keys of the ids that parse under `binding`; ids of any other binding or of the engine are skipped. */
    private static StorageKeys(binding: IExternalBinding, ids: readonly string[], identity: ExternalIdentity): ExternalFieldValue[]
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
        return keys;
    }

    private static Field(binding: IExternalBinding, member: string): string | undefined
    {
        return Object.hasOwn(binding.Binding.FieldMap, member) ? binding.Binding.FieldMap[member] : undefined;
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
