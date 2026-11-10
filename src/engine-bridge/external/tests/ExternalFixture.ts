import { MemberKind, ValueType, type IDefinitionDescription, type ISchemaDescription, type MemberInput } from '@pragmatic-tech-ai/graph';
import {
    DataSourceKind,
    WriteAtomicity,
    WriteConcurrency,
    type ConnectorBinding,
    type ConnectorSpec,
    type ExternalFieldValue,
    type ExternalRecord,
    type QueryRequest,
    type ResolvedConnection,
    type WriteBatch,
    type WriteFailure,
    type WriteResult,
    WriteFailureKind,
} from '../../../model-data/connector-plan.js';
import type { IDataSourceAdapter, IDataSourceAdapterFactory, PageQuery, PageSlice } from '../../../model-data/data-source-adapter.js';
import { InMemoryAdapter } from '../../../model-data/tests/fakes.js';
import type { IExternalBinding, IExternalConnectorPlan } from '../ExternalBinding.js';
import { ExternalIdentity } from '../ExternalIdentity.js';

/**
 * An InMemoryAdapter that logs every request (Query, QueryPage and Apply), serves keyset pages when `CanPage` is set,
 * reports `CanTransact`, and makes call `ThrowAtCall` (1-based, over all three) throw. With `IgnoreWhere` it answers
 * every read as if no Where were given (a source that matches more widely than asked). With `FailAfter` set, the next
 * Apply applies only its first `FailAfter` operations and reports every later one as a failure of `FailKind` (a
 * sequential source that fails partway); the toggle then clears.
 */
export class RecordingAdapter implements IDataSourceAdapter
{
    private static readonly Boom = 'simulated adapter failure';

    public readonly Inner = new InMemoryAdapter();
    public readonly Queries: QueryRequest[] = [];
    public readonly Pages: PageQuery[] = [];
    public readonly Batches: WriteBatch[] = [];
    public CanPage = false;
    public CanTransact = false;
    public IgnoreWhere = false;
    public ThrowAtCall: number | undefined;
    public FailAfter: number | undefined;
    public FailKind = WriteFailureKind.Error;
    private calls = 0;

    public get Calls(): number
    {
        return this.calls;
    }

    public async Query(request: QueryRequest): Promise<readonly ExternalRecord[]>
    {
        this.Count();
        this.Queries.push(request);
        return this.Inner.Query(this.Effective(request));
    }

    public async QueryPage(request: QueryRequest, page: PageQuery): Promise<PageSlice>
    {
        this.Count();
        this.Queries.push(request);
        this.Pages.push(page);
        const key = request.OrderKey ?? request.Fields[0]!;
        const rows = [...await this.Inner.Query(this.Effective(request))]
            .sort((a, b) => RecordingAdapter.Order(a[key] ?? null, b[key] ?? null))
            .filter(r => page.After === undefined || RecordingAdapter.Order(r[key] ?? null, page.After) > 0);
        const records = rows.slice(0, page.Limit);
        return records.length === page.Limit && records.length > 0
            ? { Records: records, NextAfter: records[records.length - 1]![key] ?? null }
            : { Records: records };
    }

    public async Apply(batch: WriteBatch): Promise<WriteResult>
    {
        this.Count();
        this.Batches.push(batch);
        const failAfter = this.FailAfter;
        if (failAfter === undefined)
        {
            return this.Inner.Apply(batch);
        }
        this.FailAfter = undefined;
        const applied = await this.Inner.Apply({ ...batch, Operations: batch.Operations.slice(0, failAfter) });
        const failures: WriteFailure[] = batch.Operations.slice(failAfter).map(op => ({ Key: op.Key, Kind: this.FailKind, Reason: RecordingAdapter.Boom }));
        return { Applied: applied.Applied, Failures: [...applied.Failures, ...failures] };
    }

    public async Dispose(): Promise<void>
    {
    }

    private Effective(request: QueryRequest): QueryRequest
    {
        return this.IgnoreWhere ? { Source: request.Source, Fields: request.Fields } : request;
    }

    private Count(): void
    {
        this.calls++;
        if (this.ThrowAtCall === this.calls)
        {
            throw new Error(RecordingAdapter.Boom);
        }
    }

    private static Order(a: ExternalRecord[string], b: ExternalRecord[string]): number
    {
        if (a === b) return 0;
        return (a ?? '') < (b ?? '') ? -1 : 1;
    }
}

/** Hands out one RecordingAdapter for the SQL kind. */
export class RecordingAdapterFactory implements IDataSourceAdapterFactory
{
    public readonly Kind = DataSourceKind.Sql;

    public constructor(public readonly Adapter: RecordingAdapter)
    {
    }

    public async Open(_connection: ResolvedConnection): Promise<IDataSourceAdapter>
    {
        return this.Adapter;
    }
}

/**
 * crm.Customer { id: Int64, name: String, active: Boolean, team -> crm.Team } bound to connector `crm` (source `customers`, key
 * `cust_id`), its subtype crm.VipCustomer, and crm.Team { id: String } held by the engine.
 */
export class ExternalFixture
{
    public static readonly Model = 'crm';
    public static readonly Connector = 'crm';
    public static readonly Source = 'customers';
    public static readonly Customer = 'crm.Customer';
    public static readonly Vip = 'crm.VipCustomer';
    public static readonly Team = 'crm.Team';
    public static readonly Id = 'id';
    public static readonly Name = 'name';
    public static readonly TeamRel = 'team';
    public static readonly Active = 'active';
    public static readonly IdKey = 'cust_id';
    public static readonly NameField = 'nm';
    public static readonly TeamField = 'team_fk';
    public static readonly ActiveField = 'act';
    /** The version column of an Optimistic binding (BindingWith({ VersionField: RevField })). */
    public static readonly RevField = 'rev';
    public static readonly Acme = 'Acme';
    public static readonly TeamA = 'a';
    private static readonly Version = 'ext-v1';

    public static Description(): ISchemaDescription
    {
        return {
            Version: ExternalFixture.Version,
            Indexes: [],
            Seed: [{ PublicId: ExternalFixture.TeamA, Concept: ExternalFixture.Team, Owner: ExternalFixture.Model, Properties: { [ExternalFixture.Id]: ExternalFixture.TeamA }, Links: [] }],
            Bindings: [{ Model: ExternalFixture.Model, Concept: ExternalFixture.Customer, Connector: ExternalFixture.Connector }],
            Definitions: [
                ExternalFixture.Def(ExternalFixture.Customer, [
                    ExternalFixture.Prop(ExternalFixture.Id, ValueType.Int64),
                    ExternalFixture.Prop(ExternalFixture.Name, ValueType.String),
                    ExternalFixture.Prop(ExternalFixture.Active, ValueType.Boolean),
                    { Name: ExternalFixture.TeamRel, Kind: MemberKind.Relationship, Targets: [ExternalFixture.Team] },
                ]),
                ExternalFixture.Def(ExternalFixture.Vip, [], ExternalFixture.Customer),
                ExternalFixture.Def(ExternalFixture.Team, [ExternalFixture.Prop(ExternalFixture.Id, ValueType.String)]),
            ],
        };
    }

    public static Binding(): IExternalBinding
    {
        return ExternalFixture.BindingWith({});
    }

    /** The customers binding with `overrides` applied (Writable, Concurrency, Atomicity, VersionField, ...). */
    public static BindingWith(overrides: Partial<ConnectorBinding>): IExternalBinding
    {
        const binding: ConnectorBinding = {
            Concept: ExternalFixture.Customer, Connector: ExternalFixture.Connector, Source: ExternalFixture.Source, IdKey: ExternalFixture.IdKey,
            FieldMap: { [ExternalFixture.Id]: ExternalFixture.IdKey, [ExternalFixture.Name]: ExternalFixture.NameField, [ExternalFixture.TeamRel]: ExternalFixture.TeamField,
                [ExternalFixture.Active]: ExternalFixture.ActiveField,
            },
            Writable: true, Concurrency: WriteConcurrency.LastWriteWins, Atomicity: WriteAtomicity.Sequential,
            ...overrides,
        };
        return { Model: ExternalFixture.Model, Connector: ExternalFixture.Connector, Binding: binding };
    }

    public static Spec(): ConnectorSpec
    {
        return { Name: ExternalFixture.Connector, Kind: DataSourceKind.Sql, Config: {} };
    }

    public static Plan(binding: IExternalBinding = ExternalFixture.Binding()): IExternalConnectorPlan
    {
        return { Name: ExternalFixture.Connector, Spec: ExternalFixture.Spec(), Bindings: [binding] };
    }

    public static Identity(plan: IExternalConnectorPlan): ExternalIdentity
    {
        return new ExternalIdentity(ExternalFixture.Description(), plan.Bindings);
    }

    /** A customers source record in its external field names. */
    public static Record(id: ExternalFieldValue, name: ExternalFieldValue, team: ExternalFieldValue, active: ExternalFieldValue = null): ExternalRecord
    {
        return {
            [ExternalFixture.IdKey]: id, [ExternalFixture.NameField]: name, [ExternalFixture.TeamField]: team, [ExternalFixture.ActiveField]: active,
        };
    }

    /** An adapter seeded with `records` in the customers source. */
    public static Adapter(records: ExternalRecord[]): RecordingAdapter
    {
        const adapter = new RecordingAdapter();
        adapter.Inner.Seed(ExternalFixture.Source, records);
        return adapter;
    }

    /** Every customers record as it is in the source now, in all fixture fields (bypassing the request log). */
    public static Rows(adapter: RecordingAdapter): Promise<readonly ExternalRecord[]>
    {
        return adapter.Inner.Query({
            Source: ExternalFixture.Source,
            Fields: [ExternalFixture.IdKey, ExternalFixture.NameField, ExternalFixture.TeamField, ExternalFixture.ActiveField, ExternalFixture.RevField],
        });
    }

    private static Prop(name: string, type: ValueType): MemberInput
    {
        return { Name: name, Kind: MemberKind.Property, Type: type, Nullable: true };
    }

    private static Def(name: string, members: MemberInput[], parent: string | null = null): IDefinitionDescription
    {
        return { Name: name, IsAspect: false, Parent: parent, Aspects: [], Members: members };
    }
}
