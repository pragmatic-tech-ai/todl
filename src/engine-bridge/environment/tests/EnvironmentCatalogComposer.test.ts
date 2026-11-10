import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { AccessScope, BindingTable, Cypher, GraphEngine, StorageKind } from '@pragmatic-tech-ai/graph';
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime';
import type { PackageRef } from '../../../domain/domain.js';
import { DataSourceKind, WriteAtomicity, WriteConcurrency, type ConnectorBinding, type ModelConnectorPlan } from '../../../model-data/connector-plan.js';
import { compilePackage, PackageKind, type PackageDocument } from '../../../publish/publish.js';
import { StoragePackageSource } from '../../../solution-services/package-manager/storage-package-source.js';
import { DataSourceConnector } from '../../external/DataSourceConnector.js';
import { RecordingAdapter } from '../../external/tests/ExternalFixture.js';
import { SystemNames } from '../../system/SystemNames.js';
import { EngineFixture } from '../../tests/EngineFixture.js';
import { TodlNames } from '../../TodlNames.js';
import { ConnectorPlanMerge } from '../ConnectorPlanMerge.js';
import { EnvironmentCatalogComposer, type IEnvironmentCatalog } from '../EnvironmentCatalogComposer.js';
import { EnvironmentCatalogError, EnvironmentCatalogErrorCode } from '../EnvironmentCatalogError.js';
import { EnvironmentNodePlacement } from '../EnvironmentNodePlacement.js';
import { DeliveryChannel, type IPackageDelivery } from '../PackageDelivery.js';

/** A storage that refuses to read `.todl` sources: the composer must only read compiled `model.json` documents. */
class CompiledOnlyStorage extends FakeStorage
{
    public static readonly RefusedMessage = 'runtime read a source file: ';
    private static readonly SourceSuffix = '.todl';

    public override async ReadText(path: string): Promise<string>
    {
        CompiledOnlyStorage.Refuse(path);
        return super.ReadText(path);
    }

    public override async ReadBytes(path: string): Promise<Uint8Array>
    {
        CompiledOnlyStorage.Refuse(path);
        return super.ReadBytes(path);
    }

    private static Refuse(path: string): void
    {
        if (path.endsWith(CompiledOnlyStorage.SourceSuffix)) throw new Error(CompiledOnlyStorage.RefusedMessage + path);
    }
}

/** Packages compiled in the test and published as `<id>/<version>/model.json` (only) into a storage. */
class ComposeFx
{
    public static readonly Version = '1.0.0';
    public static readonly AppA = 'app-a';
    public static readonly AppB = 'app-b';
    public static readonly AppC = 'app-c';
    public static readonly SetB = 'promote-b';
    public static readonly ShopA = 'namespace shopa { concept Order { total : string?; } model A : shopa { Order o1 { total = "1"; } } }';
    public static readonly ShopB = 'namespace shopb { concept Ticket { title : string?; } model B : shopb { Ticket t1 { title = "t"; } } }';
    public static readonly Crm = `namespace crm
{
    concept Customer { name : string?; }
    datasource crm { kind = sql; connection = "crm-db"; }
    model Crm : crm { connect crm; populate Customer key cust_id { name = "full_name"; } }
}`;
    /** A library declaring a concept and the datasource that serves it, with no binding of its own. */
    public static readonly CrmLib = 'namespace crm { concept Customer { name : string?; } datasource crm { kind = sql; connection = "crm-db"; } }';
    /** A newer library version that no longer declares the datasource. */
    public static readonly CrmLibNoSource = 'namespace crm { concept Customer { name : string?; } }';
    /** An app over CrmLib binding the library's concept to the library's datasource. */
    public static readonly CrmApp = 'namespace crm { model App : crm { connect crm; populate Customer key cust_id { name = "full_name"; } } }';
    /** CrmApp that also redeclares the library's datasource identically (ruling P16: kept in the app's own document). */
    public static readonly CrmAppRedeclared = 'namespace crm { datasource crm { kind = sql; connection = "crm-db"; } model App : crm { connect crm; populate Customer key cust_id { name = "full_name"; } } }';
    /** A newer library version whose datasource points at another connection. */
    public static readonly CrmLibOtherDb = 'namespace crm { concept Customer { name : string?; } datasource crm { kind = sql; connection = "other-db"; } }';
    public static readonly CrmConnector = 'crm@connector:crm';
    public static readonly Customer = 'crm.Customer';
    public static readonly CustomerSource = 'Customer';
    public static readonly CustomerKey = 'cust_id';
    public static readonly NameField = 'full_name';
    public static readonly CustomerName = 'Ada';
    public static readonly CrmConnection = 'crm-db';
    public static readonly CrmLibId = 'crm.lib';
    public static readonly CrmAppId = 'crm.app';
    public static readonly LeadLibId = 'crm.leads';
    /** A second library in namespace crm declaring the same datasource (identically, or with another connection). */
    public static readonly LeadLib = 'namespace crm { concept Lead { } datasource crm { kind = sql; connection = "crm-db"; } }';
    public static readonly LeadLibOtherDb = 'namespace crm { concept Lead { } datasource crm { kind = sql; connection = "other-db"; } }';
    public static readonly LeadLibNoSource = 'namespace crm { concept Lead { } }';
    /** An app over the leads library that declares datasource crm itself and binds the library's concept to it. */
    public static readonly LeadApp = 'namespace crm { datasource crm { kind = sql; connection = "crm-db"; } model App : crm { connect crm; populate Lead; } }';
    public static readonly Base = 'base';
    public static readonly Ui = 'ui';
    public static readonly BaseCust = 'base.Cust';
    public static readonly UiOrder = 'ui.Order';
    public static readonly NextVersion = '1.1.0';
    public static readonly BaseUpgrade = '1.3.0';
    public static readonly Nowhere = 'nowhere';
    public static readonly NewOrder = 'order-new';

    public readonly Storage = new CompiledOnlyStorage();
    private readonly documents = new Map<string, PackageDocument>();

    /** Compiles `text` as `id@version` over the given dependencies (each `[id, version]`, already added). */
    public async Add(id: string, text: string, deps: readonly (readonly [string, string])[] = [], version: string = ComposeFx.Version): Promise<this>
    {
        const bases = deps.map(([d, v]) => this.documents.get(`${d}@${v}`)!);
        const out = compilePackage(bases, [{ uri: `${id}.todl`, text }], { id, version },
            deps.map(([d, v]) => ({ kind: PackageKind.Library, id: d, version: v })));
        assert.ok(out.ok, JSON.stringify(out.errors));
        this.documents.set(`${id}@${version}`, out.package!.document);
        await this.Storage.WriteText(`${id}/${version}/model.json`, JSON.stringify(out.package!.document));
        return this;
    }

    public Ref(id: string, version: string = ComposeFx.Version): Required<PackageRef>
    {
        return { model: id, version };
    }

    public Deploy(name: string, ...ids: string[]): IPackageDelivery
    {
        return { Channel: DeliveryChannel.Deploy, Name: name, Packages: ids.map((id) => this.Ref(id)) };
    }

    public Promote(name: string, ...ids: string[]): IPackageDelivery
    {
        return { Channel: DeliveryChannel.Promote, Name: name, Packages: ids.map((id) => this.Ref(id)) };
    }

    public Compose(...deliveries: IPackageDelivery[]): Promise<IEnvironmentCatalog>
    {
        return EnvironmentCatalogComposer.Compose({ Deliveries: deliveries, Packages: new StoragePackageSource(this.Storage) });
    }

    public async Rejects(code: EnvironmentCatalogErrorCode, ...deliveries: IPackageDelivery[]): Promise<EnvironmentCatalogError>
    {
        let caught: unknown;
        try
        {
            await this.Compose(...deliveries);
        }
        catch (error)
        {
            caught = error;
        }
        assert.ok(caught instanceof EnvironmentCatalogError, String(caught));
        assert.equal(caught.Code, code, caught.message);
        return caught;
    }

    /** The error names every delivery in `Deliveries` and in its message text (review focus 4). */
    public static NamesDeliveries(error: EnvironmentCatalogError, ...deliveries: string[]): void
    {
        assert.deepEqual(error.Deliveries, deliveries);
        for (const delivery of deliveries) assert.ok(error.message.includes(JSON.stringify(delivery)), `${delivery} in: ${error.message}`);
    }

    /** The first column of each Cypher row, as its scalar value. */
    public static Scalars(rows: readonly (readonly unknown[])[]): unknown[]
    {
        return rows.map((row) => (row[0] as { readonly Value: unknown }).Value);
    }

    public static Names(catalog: IEnvironmentCatalog): string[]
    {
        return catalog.Description.Definitions.map((d) => d.Name);
    }

    public static Binding(concept: string, connector: string, extra: Partial<ConnectorBinding> = {}): ConnectorBinding
    {
        return {
            Concept: concept, Connector: connector, Source: 'src', IdKey: 'id', FieldMap: { id: 'id' }, Writable: true,
            Concurrency: WriteConcurrency.LastWriteWins, Atomicity: WriteAtomicity.Sequential, ...extra,
        };
    }

    public static Plan(model: string, plan: Partial<ModelConnectorPlan>): ModelConnectorPlan
    {
        return { Model: model, Version: ComposeFx.Version, Connectors: [], Bindings: [], ...plan };
    }
}

describe('EnvironmentCatalogComposer', () =>
{
    test('union of deploy and promote', async () =>
    {
        const fx = await (await new ComposeFx().Add('shop.a', ComposeFx.ShopA)).Add('shop.b', ComposeFx.ShopB);
        const catalog = await fx.Compose(fx.Deploy(ComposeFx.AppA, 'shop.a'), fx.Promote(ComposeFx.SetB, 'shop.b'));
        const names = ComposeFx.Names(catalog);
        for (const name of ['shopa.Order', 'shopb.Ticket', SystemNames.ShareGrant]) assert.ok(names.includes(name), name);
        assert.equal(catalog.Description.DefaultConnector, BindingTable.EngineStorage);
        assert.deepEqual(catalog.Packages, [fx.Ref('shop.a'), fx.Ref('shop.b'), { model: SystemNames.Model, version: SystemNames.Version }]);
        assert.equal(catalog.HomeModels.get('shopa.Order'), 'shop.a');
        assert.equal(catalog.HomeModels.get('shopb.Ticket'), 'shop.b');
        assert.equal(catalog.HomeModels.get(SystemNames.ShareGrant), SystemNames.Model);
        assert.deepEqual(catalog.Connectors, []);
        assert.deepEqual(catalog.Diagnostics, []);
        assert.ok(catalog.Snapshot.getManifest('shop.b', ComposeFx.Version));
        const again = await fx.Compose(fx.Promote(ComposeFx.SetB, 'shop.b'), fx.Deploy(ComposeFx.AppA, 'shop.a'));
        assert.equal(again.Description.Version, catalog.Description.Version, 'delivery order does not change the description');
        const engine = await GraphEngine.Open({ Description: catalog.Description, Storage: { Kind: StorageKind.Memory } });
        await engine.dispose();
    });

    test('package delivered twice stays once', async () =>
    {
        const fx = await new ComposeFx().Add('shop.a', ComposeFx.ShopA);
        const once = await fx.Compose(fx.Deploy(ComposeFx.AppA, 'shop.a'));
        const twice = await fx.Compose(fx.Deploy(ComposeFx.AppA, 'shop.a'), fx.Promote(ComposeFx.SetB, 'shop.a'));
        assert.deepEqual(twice.Packages.map((p) => p.model), ['shop.a', SystemNames.Model]);
        assert.equal(twice.Description.Definitions.filter((d) => d.Name === 'shopa.Order').length, 1);
        assert.equal(twice.Description.Version, once.Description.Version);
    });

    test('redeploy drops a package', async () =>
    {
        const fx = await (await new ComposeFx().Add('shop.a', ComposeFx.ShopA)).Add('shop.b', ComposeFx.ShopB);
        const first = await fx.Compose(fx.Deploy(ComposeFx.AppA, 'shop.a'), fx.Deploy(ComposeFx.AppB, 'shop.b'));
        const second = await fx.Compose(fx.Deploy(ComposeFx.AppA, 'shop.a'));
        assert.equal(ComposeFx.Names(second).includes('shopb.Ticket'), false);
        assert.equal(second.HomeModels.has('shopb.Ticket'), false);
        const engine = await EngineFixture.Open({ Description: first.Description, External: new Set(), Diagnostics: first.Diagnostics });
        try
        {
            const before = await engine.BeginRead(AccessScope.System);
            assert.ok(await before.ReadNode('shopb.t1'));
            before.dispose();
            await engine.Upgrade(second.Description);
            const after = await engine.BeginRead(AccessScope.System);
            assert.equal(await after.ReadNode('shopb.t1'), undefined);
            assert.ok(await after.ReadNode('shopa.o1'));
            after.dispose();
        }
        finally
        {
            await engine.dispose();
        }
    });

    test('a dependent package composes over the unified dependency without a false conflict', async () =>
    {
        const fx = await (await (await new ComposeFx()
            .Add(ComposeFx.Base, 'namespace base { concept Cust { name : string?; } }'))
            .Add(ComposeFx.Base, 'namespace base { concept Cust { name : string?; age : integer?; } }', [], ComposeFx.BaseUpgrade))
            .Add(ComposeFx.Ui, 'namespace ui { import base; concept Order { cust : base.Cust?; } model U : ui { Order u1 { } } }', [[ComposeFx.Base, ComposeFx.Version]]);
        const pinsNewBase: IPackageDelivery = { Channel: DeliveryChannel.Deploy, Name: ComposeFx.AppB, Packages: [fx.Ref(ComposeFx.Base, ComposeFx.BaseUpgrade)] };
        const catalog = await fx.Compose(fx.Deploy(ComposeFx.AppA, ComposeFx.Ui), pinsNewBase);
        assert.deepEqual(catalog.Diagnostics, []);
        assert.deepEqual(catalog.Packages, [fx.Ref(ComposeFx.Base, ComposeFx.BaseUpgrade), { model: SystemNames.Model, version: SystemNames.Version }, fx.Ref(ComposeFx.Ui)]);
        assert.deepEqual(catalog.Snapshot.manifests.filter((m) => m.model === ComposeFx.Base).map((m) => m.version), [ComposeFx.BaseUpgrade]);
        const cust = catalog.Description.Definitions.find((d) => d.Name === ComposeFx.BaseCust)!;
        assert.deepEqual(cust.Members.map((m) => m.Name), ['name', 'age']);
        assert.equal(catalog.HomeModels.get(ComposeFx.BaseCust), ComposeFx.Base);
        assert.equal(catalog.HomeModels.get(ComposeFx.UiOrder), ComposeFx.Ui);
        assert.equal(catalog.Description.Seed.find((s) => s.PublicId === 'ui.u1')?.Owner, ComposeFx.Ui);
        const engine = await GraphEngine.Open({ Description: catalog.Description, Storage: { Kind: StorageKind.Memory } });
        await engine.dispose();
    });

    test('external bindings are described with their engine connector', async () =>
    {
        const fx = await new ComposeFx().Add('crm.p', ComposeFx.Crm);
        const catalog = await fx.Compose(fx.Deploy(ComposeFx.AppA, 'crm.p'));
        assert.deepEqual(catalog.Description.Bindings, [{ Model: 'crm.p', Concept: ComposeFx.Customer, Connector: ComposeFx.CrmConnector }]);
        assert.deepEqual(catalog.Connectors.map((c) => [c.Name, c.Spec.Kind, c.Bindings.map((b) => [b.Model, b.Connector, b.Binding.Concept])]),
            [[ComposeFx.CrmConnector, DataSourceKind.Sql, [['crm.p', ComposeFx.CrmConnector, ComposeFx.Customer]]]]);
        assert.deepEqual(catalog.Identity.Bindings(), catalog.Connectors[0]!.Bindings);
        assert.equal(catalog.Identity.Mint(catalog.Connectors[0]!.Bindings[0]!, '7'), 'crm.Customer#crm@connector:crm.Customer#7');
    });

    test('a datasource declared in a dependency binds (P12)', async () =>
    {
        const fx = await (await new ComposeFx().Add(ComposeFx.CrmLibId, ComposeFx.CrmLib)).Add(ComposeFx.CrmAppId, ComposeFx.CrmApp, [[ComposeFx.CrmLibId, ComposeFx.Version]]);
        const catalog = await fx.Compose(fx.Deploy(ComposeFx.AppA, ComposeFx.CrmAppId));
        assert.deepEqual(catalog.Description.Bindings, [{ Model: ComposeFx.CrmAppId, Concept: ComposeFx.Customer, Connector: ComposeFx.CrmConnector }]);
        assert.deepEqual(catalog.Connectors.map((c) => [c.Name, c.Spec.Connection]), [[ComposeFx.CrmConnector, ComposeFx.CrmConnection]]);
        assert.deepEqual(catalog.Identity.Bindings().map((b) => b.Model), [ComposeFx.CrmAppId]);
    });

    test('a datasource that no visible package declares is an unknown connector (P12)', async () =>
    {
        const fx = await (await (await new ComposeFx().Add(ComposeFx.CrmLibId, ComposeFx.CrmLib))
            .Add(ComposeFx.CrmLibId, ComposeFx.CrmLibNoSource, [], ComposeFx.NextVersion))
            .Add(ComposeFx.CrmAppId, ComposeFx.CrmApp, [[ComposeFx.CrmLibId, ComposeFx.Version]]);
        // App B pins crm.lib@1.1.0, which no longer declares the datasource crm.app binds to.
        const pinsNewLib: IPackageDelivery = { Channel: DeliveryChannel.Deploy, Name: ComposeFx.AppB, Packages: [fx.Ref(ComposeFx.CrmLibId, ComposeFx.NextVersion)] };
        const error = await fx.Rejects(EnvironmentCatalogErrorCode.UnknownConnector, fx.Deploy(ComposeFx.AppA, ComposeFx.CrmAppId), pinsNewLib);
        assert.equal(error.Subject, ComposeFx.CrmConnector);
        ComposeFx.NamesDeliveries(error, ComposeFx.AppA);
        assert.match(error.message, /crm\.Customer/);
    });

    test('two dependencies declaring one datasource differently are a conflicting connector', async () =>
    {
        const fx = await (await (await (await new ComposeFx().Add(ComposeFx.CrmLibId, ComposeFx.CrmLib))
            .Add(ComposeFx.LeadLibId, ComposeFx.LeadLib))
            .Add(ComposeFx.LeadLibId, ComposeFx.LeadLibOtherDb, [], ComposeFx.NextVersion))
            .Add(ComposeFx.CrmAppId, ComposeFx.CrmApp, [[ComposeFx.CrmLibId, ComposeFx.Version], [ComposeFx.LeadLibId, ComposeFx.Version]]);
        // Compiled over two identical declarations, the app composes; the leads library's next version changes the connection.
        const same = await fx.Compose(fx.Deploy(ComposeFx.AppA, ComposeFx.CrmAppId));
        assert.deepEqual(same.Connectors.map((c) => [c.Name, c.Spec.Connection]), [[ComposeFx.CrmConnector, ComposeFx.CrmConnection]]);
        const pinsOtherDb: IPackageDelivery = { Channel: DeliveryChannel.Promote, Name: ComposeFx.SetB, Packages: [fx.Ref(ComposeFx.LeadLibId, ComposeFx.NextVersion)] };
        const error = await fx.Rejects(EnvironmentCatalogErrorCode.ConflictingConnector, fx.Deploy(ComposeFx.AppA, ComposeFx.CrmAppId), pinsOtherDb);
        assert.equal(error.Subject, ComposeFx.CrmConnector);
        ComposeFx.NamesDeliveries(error, ComposeFx.AppA, ComposeFx.SetB);
        assert.ok(error.message.includes(ComposeFx.CrmLibId) && error.message.includes(ComposeFx.LeadLibId), error.message);
    });

    test('an own datasource that a dependency declares differently is worded as such', async () =>
    {
        // The app declares the datasource itself over a library version that has none; the library's next version
        // declares the same id with another connection.
        const fx = await (await (await new ComposeFx().Add(ComposeFx.LeadLibId, ComposeFx.LeadLibNoSource))
            .Add(ComposeFx.LeadLibId, ComposeFx.LeadLibOtherDb, [], ComposeFx.NextVersion))
            .Add(ComposeFx.CrmAppId, ComposeFx.LeadApp, [[ComposeFx.LeadLibId, ComposeFx.Version]]);
        const own = await fx.Compose(fx.Deploy(ComposeFx.AppA, ComposeFx.CrmAppId));
        assert.deepEqual(own.Connectors.map((c) => [c.Name, c.Spec.Connection]), [[ComposeFx.CrmConnector, ComposeFx.CrmConnection]]);
        const pinsOtherDb: IPackageDelivery = { Channel: DeliveryChannel.Promote, Name: ComposeFx.SetB, Packages: [fx.Ref(ComposeFx.LeadLibId, ComposeFx.NextVersion)] };
        const error = await fx.Rejects(EnvironmentCatalogErrorCode.ConflictingConnector, fx.Deploy(ComposeFx.AppA, ComposeFx.CrmAppId), pinsOtherDb);
        assert.equal(error.Subject, ComposeFx.CrmConnector);
        ComposeFx.NamesDeliveries(error, ComposeFx.AppA, ComposeFx.SetB);
        assert.ok(error.message.startsWith(`package "${ComposeFx.CrmAppId}" declares datasource "${ComposeFx.CrmConnector}" and its dependency "${ComposeFx.LeadLibId}" declares it differently`), error.message);
    });

    test('an app redeclaring a dependency datasource identically is not re-pointed by a changed dependency (P16)', async () =>
    {
        const fx = await (await (await new ComposeFx().Add(ComposeFx.CrmLibId, ComposeFx.CrmLib))
            .Add(ComposeFx.CrmLibId, ComposeFx.CrmLibOtherDb, [], ComposeFx.NextVersion))
            .Add(ComposeFx.CrmAppId, ComposeFx.CrmAppRedeclared, [[ComposeFx.CrmLibId, ComposeFx.Version]]);
        // Identical redeclaration: one connector, one binding.
        const same = await fx.Compose(fx.Deploy(ComposeFx.AppA, ComposeFx.CrmAppId));
        assert.deepEqual(same.Connectors.map((c) => [c.Name, c.Spec.Connection]), [[ComposeFx.CrmConnector, ComposeFx.CrmConnection]]);
        assert.deepEqual(same.Description.Bindings, [{ Model: ComposeFx.CrmAppId, Concept: ComposeFx.Customer, Connector: ComposeFx.CrmConnector }]);
        // The library's next version changes the connection: the app's own declaration no longer agrees.
        const pinsOtherDb: IPackageDelivery = { Channel: DeliveryChannel.Promote, Name: ComposeFx.SetB, Packages: [fx.Ref(ComposeFx.CrmLibId, ComposeFx.NextVersion)] };
        const error = await fx.Rejects(EnvironmentCatalogErrorCode.ConflictingConnector, fx.Deploy(ComposeFx.AppA, ComposeFx.CrmAppId), pinsOtherDb);
        assert.equal(error.Subject, ComposeFx.CrmConnector);
        ComposeFx.NamesDeliveries(error, ComposeFx.AppA, ComposeFx.SetB);
        assert.ok(error.message.startsWith(`package "${ComposeFx.CrmAppId}" declares datasource "${ComposeFx.CrmConnector}" and its dependency "${ComposeFx.CrmLibId}" declares it differently`), error.message);
    });

    test('an error with no known delivery renders no deliveries clause', () =>
    {
        assert.equal(EnvironmentCatalogError.DeliveredBy([]), '');
        assert.equal(EnvironmentCatalogError.DeliveredBy([ComposeFx.AppA, ComposeFx.SetB]), ` (delivered by "${ComposeFx.AppA}", "${ComposeFx.SetB}")`);
        assert.throws(() => ConnectorPlanMerge.Merge([ComposeFx.Plan('pkg.a', { Bindings: [ComposeFx.Binding('a.Cust', ComposeFx.Nowhere)] })], new Map()),
            (error: unknown) => error instanceof EnvironmentCatalogError && !error.message.includes('delivered by') && !error.message.includes('""'));
    });

    test('a binding whose spec is absent is an unknown connector', () =>
    {
        assert.throws(() => ConnectorPlanMerge.Merge([ComposeFx.Plan('pkg.a', { Bindings: [ComposeFx.Binding('a.Cust', ComposeFx.Nowhere)] })], new Map([['pkg.a', [ComposeFx.AppA]]])),
            (error: unknown) => error instanceof EnvironmentCatalogError && error.Code === EnvironmentCatalogErrorCode.UnknownConnector
                && error.Subject === ComposeFx.Nowhere && error.message.includes(JSON.stringify(ComposeFx.AppA)));
    });

    test('builtin and todl-file bindings become engine storage', () =>
    {
        const merged = ConnectorPlanMerge.Merge([
            ComposeFx.Plan('pkg.a', {
                Connectors: [{ Id: 'a@connector:store', Name: 'store', Kind: DataSourceKind.Builtin, Config: {} }, { Id: 'a@connector:crm', Name: 'crm', Kind: DataSourceKind.Sql, Config: {} }],
                Bindings: [
                    ComposeFx.Binding('a.Note', 'store', { ConnectorId: 'a@connector:store' }),
                    ComposeFx.Binding('a.File', TodlNames.FileConnector),
                    ComposeFx.Binding('a.Cust', 'crm', { ConnectorId: 'a@connector:crm' }),
                ],
            }),
        ], new Map([['pkg.a', [ComposeFx.AppA]]]));
        assert.deepEqual(merged.Plans.map((p) => p.Bindings.map((b) => [b.Concept, b.Connector])),
            [[['a.Note', BindingTable.EngineStorage], ['a.File', BindingTable.EngineStorage], ['a.Cust', 'a@connector:crm']]]);
        assert.deepEqual(merged.External.map((b) => [b.Model, b.Connector, b.Binding.Concept, b.Binding.Connector]), [['pkg.a', 'a@connector:crm', 'a.Cust', 'crm']]);
        assert.deepEqual([...merged.Specs.keys()], ['a@connector:crm']);
    });

    test('a hand-written spec links by name', () =>
    {
        const merged = ConnectorPlanMerge.Merge([
            ComposeFx.Plan('pkg.a', { Connectors: [{ Name: 'crm', Kind: DataSourceKind.Rest, Config: {} }], Bindings: [ComposeFx.Binding('a.Cust', 'crm')] }),
        ], new Map());
        assert.deepEqual(merged.External.map((b) => b.Connector), ['crm']);
    });

    test('conflicting connector specs are rejected', async () =>
    {
        const one = 'namespace crm { concept A { } datasource crm { kind = sql; connection = "one"; } model M1 : crm { connect crm; populate A; } }';
        const two = 'namespace crm { concept B { } datasource crm { kind = sql; connection = "two"; } model M2 : crm { connect crm; populate B; } }';
        const fx = await (await new ComposeFx().Add('p.one', one)).Add('p.two', two);
        const error = await fx.Rejects(EnvironmentCatalogErrorCode.ConflictingConnector, fx.Deploy(ComposeFx.AppA, 'p.one'), fx.Promote(ComposeFx.SetB, 'p.two'));
        assert.equal(error.Subject, ComposeFx.CrmConnector);
        ComposeFx.NamesDeliveries(error, ComposeFx.AppA, ComposeFx.SetB);
        // The same spec declared twice is one connector.
        const same = await (await new ComposeFx().Add('p.one', one)).Add('p.two', two.replace('"two"', '"one"'));
        const catalog = await same.Compose(same.Deploy(ComposeFx.AppA, 'p.one', 'p.two'));
        assert.deepEqual(catalog.Connectors.map((c) => [c.Name, c.Bindings.map((b) => b.Model)]), [[ComposeFx.CrmConnector, ['p.one', 'p.two']]]);
    });

    test('duplicate external source is rejected', async () =>
    {
        const fx = await (await new ComposeFx().Add('p.one', ComposeFx.Crm)).Add('p.two', ComposeFx.Crm);
        const error = await fx.Rejects(EnvironmentCatalogErrorCode.DuplicateExternalSource, fx.Deploy(ComposeFx.AppA, 'p.one'), fx.Deploy(ComposeFx.AppC, 'p.two'));
        assert.match(error.Subject, /crm\.Customer/);
        ComposeFx.NamesDeliveries(error, ComposeFx.AppA, ComposeFx.AppC);
    });

    test('reserved connector name is rejected', () =>
    {
        for (const name of [BindingTable.EngineStorage, TodlNames.FileConnector])
        {
            assert.throws(() => ConnectorPlanMerge.Merge([
                ComposeFx.Plan('pkg.a', { Connectors: [{ Name: name, Kind: DataSourceKind.Sql, Config: {} }], Bindings: [ComposeFx.Binding('a.Cust', name)] }),
            ], new Map([['pkg.a', [ComposeFx.AppA]]])), (error: unknown) =>
            {
                assert.ok(error instanceof EnvironmentCatalogError);
                assert.equal(error.Code, EnvironmentCatalogErrorCode.ReservedConnectorName);
                assert.equal(error.Subject, name);
                ComposeFx.NamesDeliveries(error, ComposeFx.AppA);
                return true;
            });
        }
    });

    test('conflicting definition is rejected', async () =>
    {
        const fx = await (await new ComposeFx().Add('p.one', 'namespace acme { concept Customer { name : string?; } }'))
            .Add('p.two', 'namespace acme { concept Customer { age : integer?; } }');
        const error = await fx.Rejects(EnvironmentCatalogErrorCode.ConflictingDefinition, fx.Deploy(ComposeFx.AppA, 'p.one'), fx.Promote(ComposeFx.SetB, 'p.two'));
        assert.equal(error.Subject, 'acme.Customer');
        ComposeFx.NamesDeliveries(error, ComposeFx.AppA, ComposeFx.SetB);
        assert.match(error.message, /acme\.Customer/);
    });

    test('runtime compiles nothing', async () =>
    {
        const fx = await (await (await new ComposeFx().Add('crm.p', ComposeFx.Crm)).Add('shop.a', ComposeFx.ShopA)).Add('shop.b', ComposeFx.ShopB);
        await assert.rejects(fx.Storage.ReadText('x/1.0.0/src/x.todl'), (error: Error) => error.message.startsWith(CompiledOnlyStorage.RefusedMessage));
        for (const id of ['crm.p', 'shop.a', 'shop.b'])
        {
            const entries = await fx.Storage.List(`${id}/${ComposeFx.Version}`);
            assert.deepEqual(entries.map((e) => e.Name), ['model.json']);
        }
        const catalog = await fx.Compose(fx.Deploy(ComposeFx.AppA, 'crm.p', 'shop.a'), fx.Promote(ComposeFx.SetB, 'shop.b'));
        assert.equal(catalog.Packages.length, 4);
    });

    test('environment opens', async () =>
    {
        const fx = await (await new ComposeFx().Add('crm.p', ComposeFx.Crm)).Add('shop.a', ComposeFx.ShopA);
        const catalog = await fx.Compose(fx.Deploy(ComposeFx.AppA, 'crm.p', 'shop.a'));
        const adapter = new RecordingAdapter();
        adapter.Inner.Seed(ComposeFx.CustomerSource, [{ [ComposeFx.CustomerKey]: '42', [ComposeFx.NameField]: ComposeFx.CustomerName }]);
        const connectors = catalog.Connectors.map((plan) => new DataSourceConnector(plan, adapter, catalog.Identity, catalog.Description));
        const engine = await GraphEngine.Open({ Description: catalog.Description, Storage: { Kind: StorageKind.Memory }, Connectors: connectors });
        try
        {
            const cypher = new Cypher.CypherEngine(engine);
            const external = await cypher.Execute(AccessScope.System, 'MATCH (c:crm.Customer) RETURN c.name');
            assert.deepEqual(ComposeFx.Scalars(external.Rows), [ComposeFx.CustomerName]);
            // A create is placed by HomeModels: an engine node owned by the package that declares its concept.
            const placement = new EnvironmentNodePlacement(catalog.Identity, catalog.HomeModels, () => ComposeFx.NewOrder);
            await cypher.Execute(AccessScope.System, "CREATE (:shopa.Order {total: '9'})", { Placement: placement });
            const reader = await engine.BeginRead(AccessScope.System);
            try
            {
                assert.equal(await reader.OwnerOf(ComposeFx.NewOrder), 'shop.a');
                assert.equal(await reader.ConceptOf(ComposeFx.NewOrder), 'shopa.Order');
            }
            finally
            {
                reader.dispose();
            }
            const stored = await cypher.Execute(AccessScope.System, 'MATCH (o:shopa.Order) RETURN o.total ORDER BY o.total');
            assert.deepEqual(ComposeFx.Scalars(stored.Rows), ['1', '9']);
        }
        finally
        {
            await engine.dispose();
        }
    });
});
