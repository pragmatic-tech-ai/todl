import {
    ConnectorResidency,
    IdIn,
    PredicateKind,
    type CellValue,
    type ConnectorContext,
    type IConnectorCapabilities,
    type IConnectorTransaction,
    type IExternalConnector,
    type IFetchedRow,
    type IFetchPage,
    type IFetchRequest,
} from '@pragmatic-tech-ai/graph';
import type { IServiceProvider } from '@pragmatic-tech-ai/todl-runtime';
import { QueryCompareOp, type ExternalRecord, type QueryComparison, type QueryRequest } from '../../model-data/connector-plan.js';
import type { DataSourceAdapterCatalog } from '../../model-data/data-source-adapter-catalog.js';
import type { IDataSourceAdapter } from '../../model-data/data-source-adapter.js';
import { EngineBridgeError, EngineBridgeErrorCode } from '../EngineBridgeError.js';
import type { IExternalBinding, IExternalConnectorPlan } from './ExternalBinding.js';
import { ExternalIdentity } from './ExternalIdentity.js';
import { DataSourceTransaction, type IExternalRowBuilder } from './DataSourceTransaction.js';
import { ExternalValues } from './ExternalValues.js';
import { FetchTranslator, MappedMembers, type IMappedProperty } from './FetchTranslator.js';
import { ResumeToken } from './ResumeToken.js';

/** What a binding reads: its mapped properties and its mapped single-valued relationships (member → field). */
interface IBindingShape
{
    readonly Binding: IExternalBinding;
    readonly Properties: ReadonlyMap<string, IMappedProperty>;
    readonly Links: ReadonlyMap<string, string>;
}

/**
 * A Set that refuses every change once constructed (add, delete and clear throw TypeError), so a value shared by every
 * connector cannot be altered through a cast.
 */
class ImmutableSet<T> extends Set<T>
{
    private static readonly ErrImmutable = 'This set is immutable';

    private readonly sealed: boolean;

    public constructor(values: Iterable<T>)
    {
        // Set's constructor fills itself through add, before `sealed` is assigned.
        super(values);
        this.sealed = true;
        Object.freeze(this);
    }

    public override add(value: T): this
    {
        if (this.sealed === true)
        {
            throw new TypeError(ImmutableSet.ErrImmutable);
        }
        return super.add(value);
    }

    public override delete(_value: T): boolean
    {
        throw new TypeError(ImmutableSet.ErrImmutable);
    }

    public override clear(): void
    {
        throw new TypeError(ImmutableSet.ErrImmutable);
    }
}

/**
 * An engine External connector over one TODL data-source connector (rulings T5, T7, T8, P10). Residency is External:
 * the source is the truth, and the engine fetches rows on demand and stores no property data. The connector serves the
 * bindings of its plan, each exactly for its (Model, Concept); a subtype of a bound concept reads as an empty page,
 * since a source holds exactly its bound concept. Push-down is advisory and sound only: FetchTranslator sends the
 * top-level conjuncts that cannot exclude a row the engine admits (exact equality and membership on String and Boolean
 * members, null tests, ids) and drops the rest, because the engine re-checks every row. Key and reverse lookups are
 * pushed as well, and reverse rows are kept only when their mapped link holds the target, since the engine trusts them.
 * Nothing is cached: every Fetch reads the source (spec §5.2, §12). A source value that does not fit its member type
 * fails the fetch with ExternalRowInvalid; it never reads as null. The adapter is borrowed, not owned: the
 * DataSourceAdapterCatalog that opened it disposes it.
 *
 * Writes (ruling T9) go through a DataSourceTransaction per engine transaction: Apply translates and validates only,
 * Commit writes one batch per binding after reading its before-image, and Revert compensates what applied. How much a
 * failed write leaves behind depends on the adapter kind. SQL transacts per batch, so a Transactional binding's failed
 * batch applied nothing and only batches that already committed are compensated. Mongo transacts on a replica set only;
 * a standalone server cannot, so its Transactional bindings are refused at Apply and its Sequential ones compensate.
 * REST and GraphQL never transact and compensate only. Compensation restores before-images last-write-wins, so a
 * concurrent change to the same rows during the window can be overwritten: the far side is the connector's best effort
 * (spec §6), and a failed compensation surfaces as CompensationFailed.
 *
 * Each fetched row carries its version-field value as IFetchedRow.Version (ruling R119 V1); the version field is read
 * whether or not it was requested, and an Optimistic write is guarded with the version the transaction read.
 *
 * Superseded design note: spec §11.2 (engine 0.4.0 plan) replaces this write model with immediate external writes that
 * take source-assigned keys; the deferred-to-commit behavior above is M2.2's (see DataSourceTransaction).
 */
export class DataSourceConnector implements IExternalConnector, IExternalRowBuilder
{
    private static readonly ErrNoShape = 'No binding shape is known for this model and concept: ';

    private static readonly DefaultLimit = 500;
    private static readonly MaxIdBytes = 400;
    private static readonly MemberSeparator = '.';
    private static readonly ErrNoKey = 'External row has no key: ';
    private static readonly ErrLongId = 'External public id exceeds the UTF-8 byte limit (';
    private static readonly ErrLongIdEnd = '): ';
    private static readonly ErrEmptyId = 'External public id is empty: ';
    private static readonly ErrNulId = 'External public id contains U+0000: ';
    private static readonly ErrUnknownBinding = 'The connector plan binds a source its identity does not hold: ';
    private static readonly ErrModelOpen = ' (model ';
    private static readonly ErrModelClose = ')';
    private static readonly Nul = '\u0000';
    private static readonly ErrUnpagedResume = 'A resume token was given to a connector whose source does not page: ';
    private static readonly Empty: IFetchPage = Object.freeze({ Rows: Object.freeze([]) });
    private static readonly PushDown: ReadonlySet<PredicateKind> = new ImmutableSet([
        PredicateKind.True, PredicateKind.Compare, PredicateKind.In, PredicateKind.IsNull, PredicateKind.Not, PredicateKind.And, PredicateKind.IdIn,
    ]);
    private static readonly ReadCapabilities: IConnectorCapabilities = Object.freeze({
        KeyLookup: true,
        ReverseLookup: true,
        PushDown: DataSourceConnector.PushDown,
    });

    public readonly Name: string;
    public readonly Residency = ConnectorResidency.External as const;
    public readonly Capabilities = DataSourceConnector.ReadCapabilities;

    private readonly shapes = new Map<string, IBindingShape>();

    /**
     * Member lookups go through `identity`. Every binding of `plan` must be one of `identity`'s bindings (compared by
     * value: model, connector, concept, source); otherwise its rows could never be found by key and the connector
     * throws UnknownExternalBinding rather than serve empty pages.
     */
    public constructor(
        plan: IExternalConnectorPlan,
        private readonly adapter: IDataSourceAdapter,
        private readonly identity: ExternalIdentity,
    )
    {
        this.Name = plan.Name;
        for (const binding of plan.Bindings)
        {
            if (!identity.Knows(binding))
            {
                throw new EngineBridgeError(EngineBridgeErrorCode.UnknownExternalBinding, DataSourceConnector.ErrUnknownBinding + ExternalIdentity.Prefix(binding)
                    + DataSourceConnector.ErrModelOpen + binding.Model + DataSourceConnector.ErrModelClose);
            }
            this.shapes.set(DataSourceConnector.ShapeKey(binding.Model, binding.Binding.Concept), this.Shape(binding));
        }
    }

    /** Opens (or reuses) the plan's adapter through the process-wide catalog and wraps it. */
    public static async Open(
        plan: IExternalConnectorPlan,
        adapters: DataSourceAdapterCatalog,
        services: IServiceProvider,
        identity: ExternalIdentity,
    ): Promise<DataSourceConnector>
    {
        return new DataSourceConnector(plan, await adapters.Open(plan.Spec, services), identity);
    }

    /**
     * Opens the write side of one engine transaction (ruling T9; see the class comment for compensation). `context` is
     * the transaction's caller; every adapter call of the transaction, compensation included, carries it (PR12).
     */
    public Begin(context: ConnectorContext): Promise<IConnectorTransaction>
    {
        return Promise.resolve(new DataSourceTransaction(this.Name, this.adapter, this.identity, this, context));
    }

    /**
     * The fetched row of a source record under `binding` (ruling R139 E9): the fetch side's row builder, over every
     * mapped member, so a source-keyed Create can re-read and return what it inserted. The record must carry IdKey, the
     * mapped fields and the version field.
     */
    public BuildRow(binding: IExternalBinding, record: ExternalRecord): IFetchedRow
    {
        const shape = this.shapes.get(DataSourceConnector.ShapeKey(binding.Model, binding.Binding.Concept));
        if (shape === undefined)
        {
            throw new EngineBridgeError(EngineBridgeErrorCode.UnknownExternalBinding,
                DataSourceConnector.ErrNoShape + binding.Model + DataSourceConnector.ErrModelClose);
        }
        return this.Row(shape, [...shape.Properties.keys()], record);
    }

    public async Fetch(request: IFetchRequest): Promise<IFetchPage>
    {
        const shape = this.shapes.get(DataSourceConnector.ShapeKey(request.Model, request.Concept));
        if (shape === undefined)
        {
            return DataSourceConnector.Empty;
        }
        const terms: QueryComparison[] = [];
        if (request.Keys !== undefined)
        {
            terms.push(...FetchTranslator.Where(shape.Binding, new IdIn(new Set(request.Keys)), this.identity)!.All);
        }
        if (request.Reverse !== undefined)
        {
            const reverse = this.ReverseTerm(shape, request.Reverse.Relationship, request.Reverse.Target);
            if (reverse === undefined)
            {
                return DataSourceConnector.Empty;
            }
            terms.push(reverse);
        }
        terms.push(...FetchTranslator.Where(shape.Binding, request.Predicate, this.identity)?.All ?? []);
        // An empty `in` (no key or id parses under this binding) matches nothing: skip the source.
        if (terms.some(t => t.Op === QueryCompareOp.In && t.Values?.length === 0))
        {
            return DataSourceConnector.Empty;
        }
        const query: QueryRequest = { Source: shape.Binding.Binding.Source, Fields: DataSourceConnector.Fields(shape, request) };
        if (terms.length > 0)
        {
            query.Where = { All: terms };
        }
        const page = await this.Read(shape, request, query);
        return request.Reverse === undefined ? page : DataSourceConnector.Linking(page, request.Reverse.Relationship, request.Reverse.Target);
    }

    /** Reads one page; the adapter call carries `request.Context`, the reader's or transaction's caller (PR12). */
    private async Read(shape: IBindingShape, request: IFetchRequest, query: QueryRequest): Promise<IFetchPage>
    {
        const after = request.Resume === undefined ? undefined : { After: ResumeToken.Decode(request.Resume) };
        if (this.adapter.CanPage !== true || this.adapter.QueryPage === undefined)
        {
            if (after !== undefined)
            {
                throw new EngineBridgeError(EngineBridgeErrorCode.ExternalRowInvalid, DataSourceConnector.ErrUnpagedResume + request.Resume);
            }
            return { Rows: this.Rows(shape, request, await this.adapter.Query(query, request.Context)) };
        }
        query.OrderKey = shape.Binding.Binding.IdKey;
        const limit = request.Limit ?? DataSourceConnector.DefaultLimit;
        const slice = await this.adapter.QueryPage(query, after === undefined ? { Limit: limit } : { ...after, Limit: limit }, request.Context);
        const rows = this.Rows(shape, request, slice.Records);
        return slice.NextAfter === undefined ? { Rows: rows } : { Rows: rows, Resume: ResumeToken.Encode(slice.NextAfter) };
    }

    /** `eq` on the relationship's foreign-key field with the key of `target` (T6); undefined when it is unmapped. */
    private ReverseTerm(shape: IBindingShape, relationship: string, target: string): QueryComparison | undefined
    {
        const field = shape.Links.get(relationship);
        return field === undefined
            ? undefined
            : { Field: field, Op: QueryCompareOp.Eq, Value: this.identity.ForeignKey(shape.Binding, relationship, target) };
    }

    /** The rows of a reverse page whose link really holds the target: a source may match the key more widely. */
    private static Linking(page: IFetchPage, relationship: string, target: string): IFetchPage
    {
        const rows = page.Rows.filter(r => (r.Links.get(relationship) ?? []).includes(target));
        return page.Resume === undefined ? { Rows: rows } : { Rows: rows, Resume: page.Resume };
    }

    private Rows(shape: IBindingShape, request: IFetchRequest, records: readonly ExternalRecord[]): IFetchedRow[]
    {
        const members = request.Members.filter(m => shape.Properties.has(m));
        return records.map(record => this.Row(shape, members, record));
    }

    private Row(shape: IBindingShape, members: readonly string[], record: ExternalRecord): IFetchedRow
    {
        const binding = shape.Binding;
        const concept = binding.Binding.Concept;
        const key = record[binding.Binding.IdKey] ?? null;
        if (key === null)
        {
            throw new EngineBridgeError(EngineBridgeErrorCode.ExternalRowInvalid, DataSourceConnector.ErrNoKey + concept);
        }
        const publicId = DataSourceConnector.RequireId(this.identity.Mint(binding, String(key)), concept);
        const values = new Map<string, CellValue>();
        for (const member of members)
        {
            const property = shape.Properties.get(member)!;
            const subject = publicId + DataSourceConnector.MemberSeparator + member;
            values.set(member, ExternalValues.ToCell(property.Type, record[property.Field] ?? null, subject));
        }
        const links = new Map<string, readonly string[]>();
        for (const [relationship, field] of shape.Links)
        {
            const target = this.identity.LinkTarget(binding, relationship, record[field] ?? null);
            if (target !== undefined)
            {
                links.set(relationship, [DataSourceConnector.RequireId(target, publicId + DataSourceConnector.MemberSeparator + relationship)]);
            }
        }
        const versionField = binding.Binding.VersionField;
        const version = versionField === undefined
            ? undefined
            : ExternalValues.ToVersion(record[versionField] ?? null, publicId + DataSourceConnector.MemberSeparator + versionField);
        return version === undefined
            ? { PublicId: publicId, Concept: concept, Values: values, Links: links }
            : { PublicId: publicId, Concept: concept, Values: values, Links: links, Version: version };
    }

    /**
     * `id` when it is a valid engine public id (1..400 UTF-8 bytes, no U+0000, the engine's rule); otherwise
     * ExternalRowInvalid naming `subject`, so every bad id from the source fails with one code.
     */
    private static RequireId(id: string, subject: string): string
    {
        if (id.length === 0)
        {
            throw new EngineBridgeError(EngineBridgeErrorCode.ExternalRowInvalid, DataSourceConnector.ErrEmptyId + subject);
        }
        if (Buffer.byteLength(id) > DataSourceConnector.MaxIdBytes)
        {
            throw new EngineBridgeError(EngineBridgeErrorCode.ExternalRowInvalid, DataSourceConnector.ErrLongId + DataSourceConnector.MaxIdBytes + DataSourceConnector.ErrLongIdEnd + subject);
        }
        if (id.includes(DataSourceConnector.Nul))
        {
            throw new EngineBridgeError(EngineBridgeErrorCode.ExternalRowInvalid, DataSourceConnector.ErrNulId + subject);
        }
        return id;
    }

    /**
     * IdKey, the version field (always: the row carries its version, R119 V1), the field of each requested mapped
     * property, and the field of each mapped relationship (T5).
     */
    private static Fields(shape: IBindingShape, request: IFetchRequest): string[]
    {
        const fields = new Set<string>([shape.Binding.Binding.IdKey]);
        if (shape.Binding.Binding.VersionField !== undefined)
        {
            fields.add(shape.Binding.Binding.VersionField);
        }
        for (const member of request.Members)
        {
            const property = shape.Properties.get(member);
            if (property !== undefined)
            {
                fields.add(property.Field);
            }
        }
        for (const field of shape.Links.values())
        {
            fields.add(field);
        }
        return [...fields];
    }

    /** The mapped members of `binding` by the MappedMembers rule (the same one push-down uses). */
    private Shape(binding: IExternalBinding): IBindingShape
    {
        const properties = new Map<string, IMappedProperty>();
        const links = new Map<string, string>();
        for (const member of Object.keys(binding.Binding.FieldMap))
        {
            const property = MappedMembers.Property(binding, member, this.identity);
            const link = MappedMembers.Link(binding, member, this.identity);
            if (property !== undefined)
            {
                properties.set(member, property);
            }
            else if (link !== undefined)
            {
                links.set(member, link);
            }
        }
        return { Binding: binding, Properties: properties, Links: links };
    }

    private static ShapeKey(model: string, concept: string): string
    {
        return JSON.stringify([model, concept]);
    }
}
