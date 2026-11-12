import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ServiceProvider } from '@pragmatic-tech-ai/todl-runtime';
import {
    AccessScope,
    ConnectorContext,
    Cypher,
    MemberKind,
    ValueType,
    type GraphEngine,
    type IDefinitionDescription,
    type ISchemaDescription,
    type MemberInput,
} from '@pragmatic-tech-ai/graph';
import {
    DataSourceKind,
    KeyAssignment,
    WriteAtomicity,
    WriteConcurrency,
    type ConnectorBinding,
    type ConnectorSpec,
    type ExternalRecord,
} from '../../../model-data/connector-plan.js';
import type { IDataSourceAdapter, IDataSourceContext } from '../../../model-data/data-source-adapter.js';
import { InMemoryAdapter } from '../../../model-data/tests/fakes.js';
import { EngineFixture } from '../../tests/EngineFixture.js';
import { EnvironmentNodePlacement } from '../../environment/EnvironmentNodePlacement.js';
import type { IPrincipalFacts } from '../../PrincipalFacts.js';
import { DataSourceConnector } from '../DataSourceConnector.js';
import type { IExternalBinding, IExternalConnectorPlan } from '../ExternalBinding.js';
import { ExternalIdentity } from '../ExternalIdentity.js';

// A note on the deviation: the plan names "SqlAdapter on the in-memory SQL session", but TODL has no in-memory SQL
// engine. InMemoryAdapter implements the same WriteBatch/Insert contract (source-assigned serial keys, optimistic
// guards, deletes) directly, so it exercises the full engine -> bridge -> adapter immediate-write path here, while the
// SqlAdapter INSERT ... RETURNING text is covered by the dedicated SQL-adapter unit tests.

/**
 * An adapter that runs a one-shot `hook` right after its first Query returns, to drive a change the source makes
 * between a query's MATCH and its SET (ruling R139 E9, Review Focus item 2). Everything else forwards to the inner.
 */
class HookAdapter implements IDataSourceAdapter
{
    private hooked = false;

    public constructor(private readonly inner: InMemoryAdapter, private readonly hook: () => void)
    {
    }

    public get CanAssignKeys(): boolean
    {
        return true;
    }

    public async Query(request: Parameters<IDataSourceAdapter['Query']>[0], _context?: IDataSourceContext): Promise<readonly ExternalRecord[]>
    {
        const rows = await this.inner.Query(request);
        if (!this.hooked)
        {
            this.hooked = true;
            this.hook();
        }
        return rows;
    }

    public Apply(batch: Parameters<IDataSourceAdapter['Apply']>[0], _context?: IDataSourceContext): ReturnType<IDataSourceAdapter['Apply']>
    {
        return this.inner.Apply(batch);
    }

    public async Dispose(): Promise<void>
    {
        await this.inner.Dispose();
    }
}

/**
 * A shop environment with Customer (source `customers`) and Order (source `orders`, Order.customer -> Customer) both
 * source-keyed (`keys source`) on one connector over an in-memory adapter, on a real GraphEngine (MemoryStore), driven
 * through Cypher with EnvironmentNodePlacement.
 */
class E2EFixture
{
    public static readonly Model = 'shop';
    public static readonly Connector = 'shop';
    public static readonly Customer = 'shop.Customer';
    public static readonly Order = 'shop.Order';
    private static readonly Principal: IPrincipalFacts = { Id: 'u-e2e', HomeBusinessUnitId: 'bu-e2e' };

    private constructor(
        public readonly Adapter: InMemoryAdapter,
        public readonly Engine: GraphEngine,
        public readonly Identity: ExternalIdentity,
        public readonly CustomerBinding: IExternalBinding,
        public readonly OrderBinding: IExternalBinding,
    )
    {
    }

    public static async Open(customer: Partial<ConnectorBinding> = {}, hook?: (adapter: InMemoryAdapter) => void): Promise<E2EFixture>
    {
        const customerBinding = E2EFixture.CustomerBindingWith(customer);
        const orderBinding = E2EFixture.OrderBindingDef();
        const plan = E2EFixture.Plan(customerBinding, orderBinding);
        const identity = new ExternalIdentity(E2EFixture.Description(), plan.Bindings);
        const memory = new InMemoryAdapter();
        const adapter: IDataSourceAdapter = hook === undefined ? memory : new HookAdapter(memory, () => hook(memory)) as unknown as IDataSourceAdapter;
        const connector = new DataSourceConnector(plan, adapter, identity);
        const engine = await EngineFixture.Open({ Description: E2EFixture.Description(), External: new Set(), Diagnostics: [] }, { Connectors: [connector] });
        return new E2EFixture(memory, engine, identity, customerBinding, orderBinding);
    }

    /** A standalone connector over a fresh in-memory adapter with both source-keyed bindings (no engine), for unit-level Create. */
    public static StandaloneConnector(): { Connector: DataSourceConnector; Adapter: InMemoryAdapter; Identity: ExternalIdentity; Customer: IExternalBinding; Order: IExternalBinding }
    {
        const customer = E2EFixture.CustomerBindingWith({});
        const order = E2EFixture.OrderBindingDef();
        const plan = E2EFixture.Plan(customer, order);
        const identity = new ExternalIdentity(E2EFixture.Description(), plan.Bindings);
        const adapter = new InMemoryAdapter();
        return { Connector: new DataSourceConnector(plan, adapter, identity), Adapter: adapter, Identity: identity, Customer: customer, Order: order };
    }

    public Cypher(): Cypher.CypherEngine
    {
        return new Cypher.CypherEngine(this.Engine);
    }

    public Placement(): EnvironmentNodePlacement
    {
        return new EnvironmentNodePlacement(this.Identity, new Map(), new Set(), E2EFixture.Principal, randomUUID);
    }

    public Execute(text: string): Promise<Cypher.CypherResult>
    {
        return this.Cypher().Execute(AccessScope.System, text, { Placement: this.Placement() });
    }

    public Rows(source: string): Promise<readonly ExternalRecord[]>
    {
        const fields = source === 'customers' ? ['cust_id', 'nm', 'rev'] : ['ord_id', 'tot', 'cust_fk'];
        return this.Adapter.Query({ Source: source, Fields: fields });
    }

    public Mint(binding: IExternalBinding, storageId: string): string
    {
        return this.Identity.Mint(binding, storageId);
    }

    public Seed(source: string, records: ExternalRecord[]): void
    {
        this.Adapter.Seed(source, records);
    }

    public async dispose(): Promise<void>
    {
        await this.Engine.dispose();
    }

    private static CustomerBindingWith(overrides: Partial<ConnectorBinding>): IExternalBinding
    {
        const binding: ConnectorBinding = {
            Concept: E2EFixture.Customer, Connector: E2EFixture.Connector, Source: 'customers', IdKey: 'cust_id',
            FieldMap: { id: 'cust_id', name: 'nm' }, Writable: true, Concurrency: WriteConcurrency.LastWriteWins,
            Atomicity: WriteAtomicity.Sequential, KeyAssignment: KeyAssignment.Source, ...overrides,
        };
        return { Model: E2EFixture.Model, Connector: E2EFixture.Connector, Binding: binding };
    }

    private static OrderBindingDef(): IExternalBinding
    {
        const binding: ConnectorBinding = {
            Concept: E2EFixture.Order, Connector: E2EFixture.Connector, Source: 'orders', IdKey: 'ord_id',
            FieldMap: { id: 'ord_id', total: 'tot', customer: 'cust_fk' }, Writable: true, Concurrency: WriteConcurrency.LastWriteWins,
            Atomicity: WriteAtomicity.Sequential, KeyAssignment: KeyAssignment.Source,
        };
        return { Model: E2EFixture.Model, Connector: E2EFixture.Connector, Binding: binding };
    }

    private static Plan(customer: IExternalBinding, order: IExternalBinding): IExternalConnectorPlan
    {
        const spec: ConnectorSpec = { Name: E2EFixture.Connector, Kind: DataSourceKind.Sql, Config: {} };
        return { Name: E2EFixture.Connector, Spec: spec, Bindings: [customer, order] };
    }

    private static Prop(name: string, type: ValueType): MemberInput
    {
        return { Name: name, Kind: MemberKind.Property, Type: type, Nullable: true };
    }

    private static Def(name: string, members: MemberInput[]): IDefinitionDescription
    {
        return { Name: name, IsAspect: false, Parent: null, Aspects: [], Members: members };
    }

    private static Description(): ISchemaDescription
    {
        return {
            Version: 'e2e-v1', Indexes: [], Seed: [],
            Bindings: [
                { Model: E2EFixture.Model, Concept: E2EFixture.Customer, Connector: E2EFixture.Connector },
                { Model: E2EFixture.Model, Concept: E2EFixture.Order, Connector: E2EFixture.Connector },
            ],
            Definitions: [
                E2EFixture.Def(E2EFixture.Customer, [E2EFixture.Prop('id', ValueType.Int64), E2EFixture.Prop('name', ValueType.String), E2EFixture.Prop('revision', ValueType.Int64)]),
                E2EFixture.Def(E2EFixture.Order, [
                    E2EFixture.Prop('id', ValueType.Int64), E2EFixture.Prop('total', ValueType.Int64),
                    { Name: 'customer', Kind: MemberKind.Relationship, Targets: [E2EFixture.Customer] },
                ]),
            ],
        };
    }
}

describe('immediate external writes end to end', () =>
{
    test('CREATE with a foreign key to a new source-keyed row', async () =>
    {
        const fx = await E2EFixture.Open();
        try
        {
            const result = await fx.Execute("CREATE (o:`shop.Order` {total: 5})-[:customer]->(c:`shop.Customer` {name: 'a'}) RETURN o, o.id, c, c.id");
            const customers = await fx.Rows('customers');
            const orders = await fx.Rows('orders');
            assert.equal(customers.length, 1);
            assert.equal(orders.length, 1);
            // The customer was inserted first: the order's foreign key holds the customer's assigned serial.
            assert.equal(orders[0]!['cust_fk'], customers[0]!['cust_id']);
            const [o, oid, c, cid] = result.Rows[0]!;
            // o.id and c.id are the serials (Int64 members read as bigint).
            assert.equal((oid as Cypher.ScalarValue).Value, BigInt(orders[0]!['ord_id'] as number));
            assert.equal((cid as Cypher.ScalarValue).Value, BigInt(customers[0]!['cust_id'] as number));
            // The node ids are Mint(binding, serial).
            assert.equal((o as Cypher.NodeValue).Id, fx.Mint(fx.OrderBinding, String(orders[0]!['ord_id'])));
            assert.equal((c as Cypher.NodeValue).Id, fx.Mint(fx.CustomerBinding, String(customers[0]!['cust_id'])));
        }
        finally
        {
            await fx.dispose();
        }
    });

    test('create across two bindings on one connector that mint the same key keeps both rows', async () =>
    {
        // One connector spans both tables; each assigns serial 1. The two rows are distinct (minted ids differ), so both
        // must survive — and both must compensate. (On 2b192021 the raw-key dedup drops the second row -> ErrMissingRow.)
        const s = E2EFixture.StandaloneConnector();
        const txn = await s.Connector.Begin(ConnectorContext.Anonymous);
        const outcomes = await txn.Create!([
            { Owner: E2EFixture.Model, Concept: E2EFixture.Order, Properties: new Map([['total', 5n]]), Links: [] },
            { Owner: E2EFixture.Model, Concept: E2EFixture.Customer, Properties: new Map([['name', 'a']]), Links: [] },
        ]);
        assert.equal(outcomes.length, 2);
        assert.ok(outcomes[0]!.Row !== undefined && outcomes[1]!.Row !== undefined);
        assert.equal(outcomes[0]!.Row!.PublicId, s.Identity.Mint(s.Order, '1'));
        assert.equal(outcomes[1]!.Row!.PublicId, s.Identity.Mint(s.Customer, '1'));
        assert.notEqual(outcomes[0]!.Row!.PublicId, outcomes[1]!.Row!.PublicId);
        assert.equal((await s.Adapter.Query({ Source: 'orders', Fields: ['ord_id'] })).length, 1);
        assert.equal((await s.Adapter.Query({ Source: 'customers', Fields: ['cust_id'] })).length, 1);
        // Compensate the step: both rows are removed, neither orphans.
        await txn.Undo!();
        assert.equal((await s.Adapter.Query({ Source: 'orders', Fields: ['ord_id'] })).length, 0);
        assert.equal((await s.Adapter.Query({ Source: 'customers', Fields: ['cust_id'] })).length, 0);
    });

    test('abort after two statements\' steps compensates both', async () =>
    {
        const fx = await E2EFixture.Open();
        fx.Seed('customers', [{ cust_id: 1, nm: 'orig' }]);
        try
        {
            const txn = await fx.Engine.Begin(AccessScope.System);
            await txn.Flush();
            const customerId = fx.Mint(fx.CustomerBinding, '1');
            await txn.Fetch([{ PublicId: customerId, Concept: E2EFixture.Customer }]);
            txn.SetProperty(customerId, 'name', 'changed');
            await txn.Flush();
            await txn.CreateAssigned([{ Owner: E2EFixture.Model, Concept: E2EFixture.Order, Properties: new Map([['total', 7n]]), Links: [] }]);
            await txn.Abort();
            // Both steps compensated: the customer's name is back to 'orig' and no order was left behind.
            assert.deepEqual(await fx.Rows('customers'), [{ cust_id: 1, nm: 'orig' }]);
            assert.deepEqual(await fx.Rows('orders'), []);
        }
        finally
        {
            await fx.dispose();
        }
    });

    test('stale optimistic SET fails as Cypher Conflict', async () =>
    {
        // The source bumps the row's version between the query's MATCH (fetch) and its SET (write).
        const fx = await E2EFixture.Open(
            { Concurrency: WriteConcurrency.Optimistic, VersionField: 'rev', FieldMap: { id: 'cust_id', name: 'nm', revision: 'rev' } },
            (adapter) => adapter.Seed('customers', [{ cust_id: 1, nm: 'orig', rev: 2 }]));
        fx.Seed('customers', [{ cust_id: 1, nm: 'orig', rev: 1 }]);
        try
        {
            await assert.rejects(
                fx.Execute("MATCH (c:`shop.Customer`) SET c.name = 'x'"),
                (e: unknown) => e instanceof Cypher.CypherWriteError && e.WriteCode === Cypher.CypherWriteErrorCode.Conflict);
            // The write never landed: the row keeps its name.
            assert.equal((await fx.Rows('customers'))[0]!['nm'], 'orig');
        }
        finally
        {
            await fx.dispose();
        }
    });
});
