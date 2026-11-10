import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceProvider } from '@pragmatic-tech-ai/todl-runtime';
import {
    AccessScope,
    And,
    Compare,
    CompareOp,
    ConnectorResidency,
    Cypher,
    EdgeDirection,
    IsNull,
    Not,
    Predicate,
    Related,
    type IFetchRequest,
} from '@pragmatic-tech-ai/graph';
import { QueryCompareOp, type ExternalRecord } from '../../../model-data/connector-plan.js';
import { DataSourceAdapterCatalog } from '../../../model-data/data-source-adapter-catalog.js';
import { EngineBridgeError, EngineBridgeErrorCode } from '../../EngineBridgeError.js';
import { EngineFixture } from '../../tests/EngineFixture.js';
import { DataSourceConnector } from '../DataSourceConnector.js';
import { ExternalFixture as Fx, RecordingAdapter, RecordingAdapterFactory } from './ExternalFixture.js';

/** A connector over the fixture plan and a recording adapter seeded with `records`. */
class ReadHarness
{
    private static readonly Foreign = 'foreign';
    private static readonly Query = 'MATCH (c:`crm.Customer`)-[:team]->(t) RETURN c.name, t.id';

    public readonly Plan = Fx.Plan();
    public readonly Identity = Fx.Identity(this.Plan);
    public readonly Connector: DataSourceConnector;

    public constructor(public readonly Adapter: RecordingAdapter)
    {
        this.Connector = new DataSourceConnector(this.Plan, Adapter, this.Identity, Fx.Description());
    }

    public static Acme(): ExternalRecord
    {
        return { cust_id: 7, nm: Fx.Acme, team_fk: Fx.TeamA };
    }

    public static Over(records: ExternalRecord[] = [ReadHarness.Acme()]): ReadHarness
    {
        return new ReadHarness(Fx.Adapter(records));
    }

    public static Request(extra: Partial<IFetchRequest> = {}): IFetchRequest
    {
        return { Model: Fx.Model, Concept: Fx.Customer, Predicate: Predicate.True, Members: [Fx.Id, Fx.Name, Fx.TeamRel], ...extra };
    }

    public static get ForeignKey(): string
    {
        return ReadHarness.Foreign;
    }

    public static get CypherText(): string
    {
        return ReadHarness.Query;
    }

    public Mint(storageId: string): string
    {
        return this.Identity.Mint(this.Plan.Bindings[0]!, storageId);
    }

    public LastWhere(): unknown
    {
        return this.Adapter.Queries[this.Adapter.Queries.length - 1]!.Where;
    }

    public static async Rejects(action: Promise<unknown>, code: EngineBridgeErrorCode): Promise<void>
    {
        await assert.rejects(action, (e: unknown) => e instanceof EngineBridgeError && e.Code === code);
    }
}

describe('DataSourceConnector read side', () =>
{
    test('declares external residency and read capabilities', () =>
    {
        const { Connector } = ReadHarness.Over();
        assert.equal(Connector.Name, Fx.Connector);
        assert.equal(Connector.Residency, ConnectorResidency.External);
        assert.equal(Connector.Capabilities.KeyLookup, true);
        assert.equal(Connector.Capabilities.ReverseLookup, true);
        assert.equal(Connector.Capabilities.PushDown.size, 7);
    });

    test('fetch maps fields to members and mints ids', async () =>
    {
        const h = ReadHarness.Over();
        const page = await h.Connector.Fetch(ReadHarness.Request());
        assert.equal(page.Resume, undefined);
        assert.equal(page.Rows.length, 1);
        const row = page.Rows[0]!;
        assert.equal(row.PublicId, 'crm.Customer#crm.customers#7');
        assert.equal(row.Concept, Fx.Customer);
        assert.deepEqual([...row.Values], [[Fx.Id, 7n], [Fx.Name, Fx.Acme]]);
        assert.deepEqual([...row.Links], [[Fx.TeamRel, [Fx.TeamA]]]);
        assert.deepEqual([...h.Adapter.Queries[0]!.Fields].sort(), [Fx.IdKey, Fx.NameField, Fx.TeamField].sort());
        assert.equal(h.Adapter.Queries[0]!.Source, Fx.Source);
    });

    test('only requested property members are read, null stays null', async () =>
    {
        const h = ReadHarness.Over([{ cust_id: 8, nm: null, team_fk: null }]);
        const page = await h.Connector.Fetch(ReadHarness.Request({ Members: [Fx.Name] }));
        assert.deepEqual([...h.Adapter.Queries[0]!.Fields].sort(), [Fx.IdKey, Fx.NameField, Fx.TeamField].sort());
        assert.deepEqual([...page.Rows[0]!.Values], [[Fx.Name, null]]);
        assert.equal(page.Rows[0]!.Links.size, 0);
    });

    test('key lookup is a Where on IdKey', async () =>
    {
        const h = ReadHarness.Over();
        const page = await h.Connector.Fetch(ReadHarness.Request({ Keys: [h.Mint('7'), ReadHarness.ForeignKey] }));
        assert.deepEqual(h.LastWhere(), { All: [{ Field: Fx.IdKey, Op: QueryCompareOp.In, Value: null, Values: [7] }] });
        assert.equal(page.Rows.length, 1);

        const none = await h.Connector.Fetch(ReadHarness.Request({ Keys: [ReadHarness.ForeignKey] }));
        assert.equal(h.Adapter.Calls, 1);
        assert.deepEqual(none.Rows, []);
    });

    test('reverse lookup is a Where on the foreign key', async () =>
    {
        const h = ReadHarness.Over();
        const page = await h.Connector.Fetch(ReadHarness.Request({ Reverse: { Relationship: Fx.TeamRel, Target: Fx.TeamA } }));
        assert.deepEqual(h.LastWhere(), { All: [{ Field: Fx.TeamField, Op: QueryCompareOp.Eq, Value: Fx.TeamA }] });
        assert.equal(page.Rows.length, 1);
    });

    test('reverse lookup over an unmapped relationship is empty', async () =>
    {
        const h = ReadHarness.Over();
        const page = await h.Connector.Fetch(ReadHarness.Request({ Reverse: { Relationship: Fx.Name, Target: Fx.TeamA } }));
        assert.equal(h.Adapter.Calls, 0);
        assert.deepEqual(page.Rows, []);
    });

    test('pushes down translatable conjuncts only', async () =>
    {
        const h = ReadHarness.Over();
        const predicate = new And([new Compare(Fx.Name, CompareOp.Eq, Fx.Acme), new Related(Fx.TeamRel, EdgeDirection.Out, Predicate.True)]);
        await h.Connector.Fetch(ReadHarness.Request({ Predicate: predicate }));
        assert.deepEqual(h.LastWhere(), { All: [{ Field: Fx.NameField, Op: QueryCompareOp.Eq, Value: Fx.Acme }] });
    });

    test('Not IsNull becomes isNotNull', async () =>
    {
        const h = ReadHarness.Over();
        await h.Connector.Fetch(ReadHarness.Request({ Predicate: new Not(new IsNull(Fx.Name)) }));
        assert.deepEqual(h.LastWhere(), { All: [{ Field: Fx.NameField, Op: QueryCompareOp.IsNotNull, Value: null }] });
    });

    test('subtype request on a bound ancestor is empty', async () =>
    {
        const h = ReadHarness.Over();
        const page = await h.Connector.Fetch(ReadHarness.Request({ Concept: Fx.Vip }));
        assert.deepEqual(page.Rows, []);
        assert.equal(h.Adapter.Calls, 0);
    });

    test('pages through QueryPage with a resume token', async () =>
    {
        const h = ReadHarness.Over([ReadHarness.Acme(), { cust_id: 8, nm: 'B', team_fk: null }, { cust_id: 9, nm: 'C', team_fk: null }]);
        h.Adapter.CanPage = true;
        const first = await h.Connector.Fetch(ReadHarness.Request({ Limit: 2 }));
        assert.equal(first.Rows.length, 2);
        assert.notEqual(first.Resume, undefined);
        assert.equal(h.Adapter.Queries[0]!.OrderKey, Fx.IdKey);
        assert.deepEqual(h.Adapter.Pages[0], { Limit: 2 });

        const second = await h.Connector.Fetch(ReadHarness.Request({ Limit: 2, Resume: first.Resume! }));
        assert.deepEqual(second.Rows.map(r => r.PublicId), [h.Mint('9')]);
        assert.equal(second.Resume, undefined);
        assert.deepEqual(h.Adapter.Pages[1], { After: 8, Limit: 2 });
    });

    test('paging defaults to 500 rows', async () =>
    {
        const h = ReadHarness.Over();
        h.Adapter.CanPage = true;
        await h.Connector.Fetch(ReadHarness.Request());
        assert.deepEqual(h.Adapter.Pages[0], { Limit: 500 });
    });

    test('malformed resume token fails', async () =>
    {
        const h = ReadHarness.Over();
        h.Adapter.CanPage = true;
        await ReadHarness.Rejects(h.Connector.Fetch(ReadHarness.Request({ Resume: 'garbage' })), EngineBridgeErrorCode.ExternalRowInvalid);
        await ReadHarness.Rejects(h.Connector.Fetch(ReadHarness.Request({ Resume: '1.!!' })), EngineBridgeErrorCode.ExternalRowInvalid);
        const noAfter = '1.' + Buffer.from(JSON.stringify({ Other: 1 })).toString('base64url');
        await ReadHarness.Rejects(h.Connector.Fetch(ReadHarness.Request({ Resume: noAfter })), EngineBridgeErrorCode.ExternalRowInvalid);
        assert.equal(h.Adapter.Calls, 0);
    });

    test('unconvertible value fails the fetch', async () =>
    {
        const text = ReadHarness.Over([{ cust_id: '12x', nm: Fx.Acme, team_fk: null }]);
        await ReadHarness.Rejects(text.Connector.Fetch(ReadHarness.Request()), EngineBridgeErrorCode.ExternalRowInvalid);
        const number = ReadHarness.Over([{ cust_id: 7, nm: 5, team_fk: null }]);
        await ReadHarness.Rejects(number.Connector.Fetch(ReadHarness.Request()), EngineBridgeErrorCode.ExternalRowInvalid);
    });

    test('a row without a key, or with an over-long id, fails the fetch', async () =>
    {
        const keyless = ReadHarness.Over([{ cust_id: null, nm: Fx.Acme, team_fk: null }]);
        await ReadHarness.Rejects(keyless.Connector.Fetch(ReadHarness.Request()), EngineBridgeErrorCode.ExternalRowInvalid);
        const long = ReadHarness.Over([{ cust_id: 'x'.repeat(400), nm: Fx.Acme, team_fk: null }]);
        await ReadHarness.Rejects(long.Connector.Fetch(ReadHarness.Request({ Members: [Fx.Name] })), EngineBridgeErrorCode.ExternalRowInvalid);
    });

    test('engine round trip', async () =>
    {
        const adapter = Fx.Adapter([ReadHarness.Acme()]);
        const plan = Fx.Plan();
        const catalog = new DataSourceAdapterCatalog().Register(new RecordingAdapterFactory(adapter));
        const connector = await DataSourceConnector.Open(plan, catalog, new ServiceProvider(), Fx.Identity(plan), Fx.Description());
        const engine = await EngineFixture.Open({ Description: Fx.Description(), External: new Set(), Diagnostics: [] }, [connector]);
        try
        {
            const cypher = new Cypher.CypherEngine(engine);
            const first = Cypher.CypherEngine.ToDto(await cypher.Execute(AccessScope.System, ReadHarness.CypherText));
            assert.deepEqual(first.Rows, [[Fx.Acme, Fx.TeamA]]);
            const once = adapter.Calls;
            await cypher.Execute(AccessScope.System, ReadHarness.CypherText);
            assert.equal(once, 1);
            assert.equal(adapter.Calls, 2);
        }
        finally
        {
            await engine.dispose();
            await catalog.Dispose();
        }
    });
});
