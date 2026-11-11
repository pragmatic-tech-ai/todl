import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceProvider } from '@pragmatic-tech-ai/todl-runtime';
import {
    AccessScope,
    And,
    Compare,
    CompareOp,
    ConnectorContext,
    ConnectorResidency,
    Cypher,
    DateValue,
    EdgeDirection,
    IdIn,
    In,
    IsNull,
    Not,
    Predicate,
    PredicateKind,
    Related,
    type IFetchedRow,
    type IFetchRequest,
} from '@pragmatic-tech-ai/graph';
import { QueryCompareOp, type ExternalRecord } from '../../../model-data/connector-plan.js';
import { DataSourceAdapterCatalog } from '../../../model-data/data-source-adapter-catalog.js';
import { EngineBridgeError, EngineBridgeErrorCode } from '../../EngineBridgeError.js';
import { EngineFixture } from '../../tests/EngineFixture.js';
import { DataSourceConnector } from '../DataSourceConnector.js';
import type { IExternalBinding, IExternalConnectorPlan } from '../ExternalBinding.js';
import type { ExternalIdentity } from '../ExternalIdentity.js';
import { ResumeToken } from '../ResumeToken.js';
import { ExternalFixture as Fx, RecordingAdapter, RecordingAdapterFactory } from './ExternalFixture.js';

/** A connector over the fixture plan and a recording adapter seeded with `records`. */
class ReadHarness
{
    public static readonly ForeignKey = 'foreign';
    public static readonly CypherText = 'MATCH (c:`crm.Customer`)-[:team]->(t) RETURN c.name, t.id';
    public static readonly Beta = 'Beta';
    public static readonly TeamB = 'b';
    public static readonly TokenEncoding = 'base64url';
    public static readonly OtherSource = 'clients';
    public static readonly Etag = 'W/"4"';
    public static readonly VersionKey = 'Version';
    public static readonly Nul = 'a\u0000b';
    public static readonly Alice = 'alice';

    public readonly Plan: IExternalConnectorPlan;
    public readonly Identity: ExternalIdentity;
    public readonly Connector: DataSourceConnector;

    public constructor(public readonly Adapter: RecordingAdapter, binding: IExternalBinding = Fx.Binding())
    {
        this.Plan = Fx.Plan(binding);
        this.Identity = Fx.Identity(this.Plan);
        this.Connector = new DataSourceConnector(this.Plan, Adapter, this.Identity);
    }

    /** Customer 7 (Acme) whose version column holds `version`, under the Optimistic binding. */
    public static Versioned(version: ExternalRecord[string]): ReadHarness
    {
        return new ReadHarness(Fx.Adapter([{ ...ReadHarness.Acme(), [Fx.RevField]: version }]), Fx.OptimisticBinding());
    }

    public static Acme(): ExternalRecord
    {
        return Fx.Record(7, Fx.Acme, Fx.TeamA);
    }

    public static Over(records: ExternalRecord[] = [ReadHarness.Acme()]): ReadHarness
    {
        return new ReadHarness(Fx.Adapter(records));
    }

    public static Request(extra: Partial<IFetchRequest> = {}): IFetchRequest
    {
        return { Model: Fx.Model, Concept: Fx.Customer, Predicate: Predicate.True, Members: [Fx.Id, Fx.Name, Fx.TeamRel], Context: ConnectorContext.Anonymous, ...extra };
    }

    public Mint(storageId: string): string
    {
        return this.Identity.Mint(this.Plan.Bindings[0]!, storageId);
    }

    public LastWhere(): unknown
    {
        return this.Adapter.Queries[this.Adapter.Queries.length - 1]!.Where;
    }

    /** Three customers: 7 Acme (team a, active), '012' Beta (no team, inactive), 9 null name (team b, active unknown). */
    public static Mixed(): ReadHarness
    {
        return ReadHarness.Over([Fx.Record(7, Fx.Acme, Fx.TeamA, true), Fx.Record('012', ReadHarness.Beta, null, false), Fx.Record(9, null, ReadHarness.TeamB)]);
    }

    /** The ids a fetch under `predicate` returns. */
    public async Ids(predicate: Predicate, extra: Partial<IFetchRequest> = {}): Promise<string[]>
    {
        return (await this.Connector.Fetch(ReadHarness.Request({ ...extra, Predicate: predicate }))).Rows.map(r => r.PublicId);
    }

    /** Asserts `predicate` is not pushed down and returns exactly the rows of no push-down. */
    public async AssertNotPushed(predicate: Predicate): Promise<void>
    {
        const unpushed = await this.Ids(Predicate.True);
        const pushed = await this.Ids(predicate);
        assert.equal(this.LastWhere(), undefined);
        assert.deepEqual(pushed, unpushed);
    }

    /**
     * Asserts `predicate` is pushed as `where`, and that the pushed rows are exactly the unpushed rows the engine would
     * keep (`keep`).
     */
    public async AssertPushed(predicate: Predicate, where: unknown, keep: (row: IFetchedRow) => boolean): Promise<void>
    {
        const members = { Members: [Fx.Id, Fx.Name, Fx.Active, Fx.TeamRel] };
        const unpushed = (await this.Connector.Fetch(ReadHarness.Request(members))).Rows.filter(keep).map(r => r.PublicId);
        const pushed = await this.Ids(predicate, members);
        assert.deepEqual(this.LastWhere(), where);
        assert.deepEqual(pushed, unpushed);
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

    test('capabilities cannot be changed at runtime', () =>
    {
        const { Connector } = ReadHarness.Over();
        const kinds = Connector.Capabilities.PushDown as Set<PredicateKind>;
        assert.throws(() => kinds.add(PredicateKind.Or), TypeError);
        assert.throws(() => kinds.delete(PredicateKind.Compare), TypeError);
        assert.throws(() => kinds.clear(), TypeError);
        assert.throws(() => { (Connector.Capabilities as { KeyLookup: boolean }).KeyLookup = false; }, TypeError);
        assert.equal(ReadHarness.Over().Connector.Capabilities.PushDown.size, 7);
        assert.equal(kinds.has(PredicateKind.Or), false);
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
        const h = ReadHarness.Over([Fx.Record(8, null, null)]);
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

    test('a relationship member is never pushed down', async () =>
    {
        const h = ReadHarness.Mixed();
        await h.AssertNotPushed(new IsNull(Fx.TeamRel));
        await h.AssertNotPushed(new Not(new IsNull(Fx.TeamRel)));
        await h.AssertNotPushed(new Compare(Fx.TeamRel, CompareOp.Eq, Fx.TeamA));
        await h.AssertNotPushed(new In(Fx.TeamRel, [Fx.TeamA]));
    });

    test('numeric equality and membership are not pushed', async () =>
    {
        const h = ReadHarness.Mixed();
        // '012' reads as 12n: a source comparison on the raw field would lose that row.
        await h.AssertNotPushed(new Compare(Fx.Id, CompareOp.Eq, 12n));
        await h.AssertNotPushed(new In(Fx.Id, [12n]));
    });

    test('inequality and ranges are not pushed', async () =>
    {
        const h = ReadHarness.Mixed();
        await h.AssertNotPushed(new Compare(Fx.Name, CompareOp.Ne, Fx.Acme));
        for (const op of [CompareOp.Lt, CompareOp.Le, CompareOp.Gt, CompareOp.Ge])
        {
            await h.AssertNotPushed(new Compare(Fx.Name, op, ReadHarness.Beta));
            await h.AssertNotPushed(new Compare(Fx.Id, op, 8n));
        }
    });

    test('unmapped members, unsafe bigints and temporal values are not pushed', async () =>
    {
        const h = ReadHarness.Mixed();
        await h.AssertNotPushed(new Compare(ReadHarness.ForeignKey, CompareOp.Eq, Fx.Acme));
        await h.AssertNotPushed(new IsNull(ReadHarness.ForeignKey));
        await h.AssertNotPushed(new Compare(Fx.Name, CompareOp.Eq, 2n ** 60n));
        await h.AssertNotPushed(new Compare(Fx.Name, CompareOp.Eq, new DateValue(1)));
        await h.AssertNotPushed(new In(Fx.Name, [Fx.Acme, 2n ** 60n]));
    });

    test('String equality and membership are pushed', async () =>
    {
        const h = ReadHarness.Mixed();
        assert.deepEqual(await h.Ids(new Compare(Fx.Name, CompareOp.Eq, Fx.Acme)), [h.Mint('7')]);
        assert.deepEqual(h.LastWhere(), { All: [{ Field: Fx.NameField, Op: QueryCompareOp.Eq, Value: Fx.Acme }] });
        assert.deepEqual(await h.Ids(new In(Fx.Name, [Fx.Acme, ReadHarness.Beta])), [h.Mint('7'), h.Mint('012')]);
        assert.deepEqual(h.LastWhere(), { All: [{ Field: Fx.NameField, Op: QueryCompareOp.In, Value: null, Values: [Fx.Acme, ReadHarness.Beta] }] });
        assert.deepEqual(await h.Ids(new IsNull(Fx.Name)), [h.Mint('9')]);
        assert.deepEqual(h.LastWhere(), { All: [{ Field: Fx.NameField, Op: QueryCompareOp.IsNull, Value: null }] });
    });

    test('Boolean equality and membership are pushed', async () =>
    {
        const h = ReadHarness.Mixed();
        await h.AssertPushed(new Compare(Fx.Active, CompareOp.Eq, true),
            { All: [{ Field: Fx.ActiveField, Op: QueryCompareOp.Eq, Value: true }] }, r => r.Values.get(Fx.Active) === true);
        await h.AssertPushed(new Compare(Fx.Active, CompareOp.Eq, false),
            { All: [{ Field: Fx.ActiveField, Op: QueryCompareOp.Eq, Value: false }] }, r => r.Values.get(Fx.Active) === false);
        await h.AssertPushed(new In(Fx.Active, [true, false]),
            { All: [{ Field: Fx.ActiveField, Op: QueryCompareOp.In, Value: null, Values: [true, false] }] }, r => r.Values.get(Fx.Active) !== null);
        await h.AssertNotPushed(new Compare(Fx.Active, CompareOp.Ne, true));
    });

    test('IdIn pushes the ids of this binding only', async () =>
    {
        const h = ReadHarness.Mixed();
        assert.deepEqual(await h.Ids(new IdIn(new Set([h.Mint('9'), ReadHarness.ForeignKey]))), [h.Mint('9')]);
        assert.deepEqual(h.LastWhere(), { All: [{ Field: Fx.IdKey, Op: QueryCompareOp.In, Value: null, Values: [9] }] });

        const calls = h.Adapter.Calls;
        assert.deepEqual(await h.Ids(new IdIn(new Set([ReadHarness.ForeignKey]))), []);
        assert.equal(h.Adapter.Calls, calls);
    });

    test('keys combine with the predicate and paging', async () =>
    {
        const h = ReadHarness.Mixed();
        h.Adapter.CanPage = true;
        const page = await h.Connector.Fetch(ReadHarness.Request({
            Keys: [h.Mint('7'), h.Mint('9')], Predicate: new Not(new IsNull(Fx.Name)), Limit: 1,
        }));
        assert.deepEqual(h.LastWhere(), { All: [
            { Field: Fx.IdKey, Op: QueryCompareOp.In, Value: null, Values: [7, 9] },
            { Field: Fx.NameField, Op: QueryCompareOp.IsNotNull, Value: null },
        ] });
        assert.equal(h.Adapter.Queries[0]!.OrderKey, Fx.IdKey);
        assert.deepEqual(page.Rows.map(r => r.PublicId), [h.Mint('7')]);
        assert.notEqual(page.Resume, undefined);
    });

    test('reverse rows keep only those whose link holds the target', async () =>
    {
        const h = ReadHarness.Mixed();
        h.Adapter.IgnoreWhere = true;
        const page = await h.Connector.Fetch(ReadHarness.Request({ Reverse: { Relationship: Fx.TeamRel, Target: Fx.TeamA } }));
        assert.deepEqual(page.Rows.map(r => r.PublicId), [h.Mint('7')]);
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
        const h = ReadHarness.Over([ReadHarness.Acme(), Fx.Record(8, 'B', null), Fx.Record(9, 'C', null)]);
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

    test('fetch forwards the request context to Query', async () =>
    {
        const h = ReadHarness.Over();
        await h.Connector.Fetch(ReadHarness.Request({ Context: ConnectorContext.For(ReadHarness.Alice) }));
        assert.deepEqual(h.Adapter.QueryContexts.map(c => c?.Key), [ReadHarness.Alice]);
    });

    test('a paged fetch forwards the context to QueryPage on every page', async () =>
    {
        const h = ReadHarness.Over([ReadHarness.Acme(), Fx.Record(8, 'B', null), Fx.Record(9, 'C', null)]);
        h.Adapter.CanPage = true;
        const alice = ConnectorContext.For(ReadHarness.Alice);
        const first = await h.Connector.Fetch(ReadHarness.Request({ Limit: 2, Context: alice }));
        await h.Connector.Fetch(ReadHarness.Request({ Limit: 2, Resume: first.Resume!, Context: alice }));
        assert.equal(h.Adapter.Pages.length, 2);
        assert.deepEqual(h.Adapter.QueryContexts, [alice, alice]);
    });

    test('an anonymous request is forwarded as anonymous', async () =>
    {
        const h = ReadHarness.Over();
        await h.Connector.Fetch(ReadHarness.Request());
        const recorded = h.Adapter.QueryContexts[0];
        assert.ok(recorded instanceof ConnectorContext);
        assert.equal(recorded.IsAnonymous, true);
    });

    test('malformed resume token fails', async () =>
    {
        const h = ReadHarness.Over();
        h.Adapter.CanPage = true;
        await ReadHarness.Rejects(h.Connector.Fetch(ReadHarness.Request({ Resume: 'garbage' })), EngineBridgeErrorCode.ExternalRowInvalid);
        await ReadHarness.Rejects(h.Connector.Fetch(ReadHarness.Request({ Resume: '1.!!' })), EngineBridgeErrorCode.ExternalRowInvalid);
        const noAfter = ResumeToken.Prefix + Buffer.from(JSON.stringify({ Other: 1 })).toString(ReadHarness.TokenEncoding);
        await ReadHarness.Rejects(h.Connector.Fetch(ReadHarness.Request({ Resume: noAfter })), EngineBridgeErrorCode.ExternalRowInvalid);
        assert.equal(h.Adapter.Calls, 0);
    });

    test('a resume token to a source that does not page fails', async () =>
    {
        const h = ReadHarness.Over();
        await ReadHarness.Rejects(h.Connector.Fetch(ReadHarness.Request({ Resume: ResumeToken.Encode(7) })), EngineBridgeErrorCode.ExternalRowInvalid);
        await ReadHarness.Rejects(h.Connector.Fetch(ReadHarness.Request({ Resume: 'garbage' })), EngineBridgeErrorCode.ExternalRowInvalid);
        assert.equal(h.Adapter.Calls, 0);
    });

    test('unconvertible value fails the fetch', async () =>
    {
        const text = ReadHarness.Over([Fx.Record('12x', Fx.Acme, null)]);
        await ReadHarness.Rejects(text.Connector.Fetch(ReadHarness.Request()), EngineBridgeErrorCode.ExternalRowInvalid);
        const number = ReadHarness.Over([Fx.Record(7, 5, null)]);
        await ReadHarness.Rejects(number.Connector.Fetch(ReadHarness.Request()), EngineBridgeErrorCode.ExternalRowInvalid);
    });

    test('fetched row carries the source version', async () =>
    {
        const h = ReadHarness.Versioned(4);
        const rows = (await h.Connector.Fetch(ReadHarness.Request())).Rows;
        assert.equal(rows[0]!.Version, 4);
    });

    test('version field is fetched even when not requested', async () =>
    {
        const h = ReadHarness.Versioned(ReadHarness.Etag);
        const rows = (await h.Connector.Fetch(ReadHarness.Request({ Members: [Fx.Name] }))).Rows;
        assert.ok(h.Adapter.Queries[0]!.Fields.includes(Fx.RevField));
        assert.equal(rows[0]!.Version, ReadHarness.Etag);
        assert.equal(rows[0]!.Values.has(Fx.Revision), false);
    });

    test('boolean version is invalid', async () =>
    {
        const h = ReadHarness.Versioned(true);
        await ReadHarness.Rejects(h.Connector.Fetch(ReadHarness.Request()), EngineBridgeErrorCode.ExternalRowInvalid);
    });

    test('no version field, no version', async () =>
    {
        const h = ReadHarness.Over([{ ...ReadHarness.Acme(), [Fx.RevField]: 4 }]);
        const rows = (await h.Connector.Fetch(ReadHarness.Request())).Rows;
        assert.equal(Object.hasOwn(rows[0]!, ReadHarness.VersionKey), false);
        assert.equal(h.Adapter.Queries[0]!.Fields.includes(Fx.RevField), false);
        // A null version reads as absent.
        const unversioned = ReadHarness.Versioned(null);
        assert.equal((await unversioned.Connector.Fetch(ReadHarness.Request())).Rows[0]!.Version, undefined);
    });

    test('a row without a key, or with an over-long id, fails the fetch', async () =>
    {
        const keyless = ReadHarness.Over([Fx.Record(null, Fx.Acme, null)]);
        await ReadHarness.Rejects(keyless.Connector.Fetch(ReadHarness.Request()), EngineBridgeErrorCode.ExternalRowInvalid);
        const long = ReadHarness.Over([Fx.Record('x'.repeat(400), Fx.Acme, null)]);
        await ReadHarness.Rejects(long.Connector.Fetch(ReadHarness.Request({ Members: [Fx.Name] })), EngineBridgeErrorCode.ExternalRowInvalid);
        // Every id the source supplies (row key, link target) is checked with the engine's rule, under one code.
        const nulKey = ReadHarness.Over([Fx.Record(ReadHarness.Nul, Fx.Acme, null)]);
        await ReadHarness.Rejects(nulKey.Connector.Fetch(ReadHarness.Request()), EngineBridgeErrorCode.ExternalRowInvalid);
        const nulLink = ReadHarness.Over([Fx.Record(7, Fx.Acme, ReadHarness.Nul)]);
        await ReadHarness.Rejects(nulLink.Connector.Fetch(ReadHarness.Request()), EngineBridgeErrorCode.ExternalRowInvalid);
        const longLink = ReadHarness.Over([Fx.Record(7, Fx.Acme, 'x'.repeat(401))]);
        await ReadHarness.Rejects(longLink.Connector.Fetch(ReadHarness.Request()), EngineBridgeErrorCode.ExternalRowInvalid);
    });

    test('bindings pair with the identity by value, and an unknown binding is refused at construction', async () =>
    {
        // Plan and identity built separately (as after a recompose or a deserialized plan): equal, not identical, bindings.
        const adapter = Fx.Adapter([ReadHarness.Acme()]);
        const plan = Fx.Plan();
        const identity = Fx.Identity(Fx.Plan());
        assert.notEqual(plan.Bindings[0], identity.Bindings()[0]);
        const connector = new DataSourceConnector(plan, adapter, identity);
        const key = identity.Mint(plan.Bindings[0]!, String(7));
        const page = await connector.Fetch(ReadHarness.Request({ Keys: [key] }));
        assert.deepEqual(page.Rows.map(r => r.PublicId), [key]);
        assert.equal(adapter.Calls, 1);

        const elsewhere = Fx.Identity(Fx.Plan(Fx.BindingWith({ Source: ReadHarness.OtherSource })));
        assert.throws(() => new DataSourceConnector(plan, adapter, elsewhere),
            (e: unknown) => e instanceof EngineBridgeError && e.Code === EngineBridgeErrorCode.UnknownExternalBinding);
    });

    test('engine round trip', async () =>
    {
        const adapter = Fx.Adapter([ReadHarness.Acme()]);
        const plan = Fx.Plan();
        const catalog = new DataSourceAdapterCatalog().Register(new RecordingAdapterFactory(adapter));
        const connector = await DataSourceConnector.Open(plan, catalog, new ServiceProvider(), Fx.Identity(plan));
        const engine = await EngineFixture.Open({ Description: Fx.Description(), External: new Set(), Diagnostics: [] }, { Connectors: [connector] });
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
