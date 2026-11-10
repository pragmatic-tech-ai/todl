import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
    AccessScope,
    BindingTable,
    ConnectorResidency,
    Cypher,
    GraphEngine,
    StorageKind,
    type IConnectorTransaction,
    type IExternalConnector,
    type IFetchPage,
    type IFetchRequest,
} from '@pragmatic-tech-ai/graph';
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime';
import type { PackageRef } from '../../../domain/domain.js';
import { DataSourceKind, WriteAtomicity, WriteConcurrency, type ConnectorBinding, type ModelConnectorPlan } from '../../../model-data/connector-plan.js';
import { compilePackage, PackageKind, type PackageDocument } from '../../../publish/publish.js';
import { StoragePackageSource } from '../../../solution-services/package-manager/storage-package-source.js';
import type { IExternalConnectorPlan } from '../../external/ExternalBinding.js';
import { SystemNames } from '../../system/SystemNames.js';
import { EngineFixture } from '../../tests/EngineFixture.js';
import { TodlNames } from '../../TodlNames.js';
import { ConnectorPlanMerge } from '../ConnectorPlanMerge.js';
import { DeliveryChannel, EnvironmentCatalogComposer, type IEnvironmentCatalog, type IPackageDelivery } from '../EnvironmentCatalogComposer.js';
import { EnvironmentCatalogError, EnvironmentCatalogErrorCode } from '../EnvironmentCatalogError.js';

/** A storage that refuses to read `.todl` sources: the composer must only read compiled `model.json` documents. */
class CompiledOnlyStorage extends FakeStorage
{
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
        if (path.endsWith(CompiledOnlyStorage.SourceSuffix)) throw new Error(`runtime read a source file: ${path}`);
    }
}

/** Packages compiled in the test and published as `<id>/<version>/model.json` (only) into a storage. */
class ComposeFx
{
    public static readonly Version = '1.0.0';
    public static readonly AppA = 'app-a';
    public static readonly SetB = 'promote-b';
    public static readonly ShopA = 'namespace shopa { concept Order { total : string?; } model A : shopa { Order o1 { total = "1"; } } }';
    public static readonly ShopB = 'namespace shopb { concept Ticket { title : string?; } model B : shopb { Ticket t1 { title = "t"; } } }';
    public static readonly Crm = `namespace crm
{
    concept Customer { name : string?; }
    datasource crm { kind = sql; connection = "crm-db"; }
    model Crm : crm { connect crm; populate Customer key cust_id { name = "full_name"; } }
}`;

    public readonly Storage = new CompiledOnlyStorage();
    private readonly documents = new Map<string, PackageDocument>();

    public async Add(id: string, text: string, deps: readonly string[] = []): Promise<this>
    {
        const bases = deps.map((d) => this.documents.get(d)!);
        const out = compilePackage(bases, [{ uri: `${id}.todl`, text }], { id, version: ComposeFx.Version },
            deps.map((d) => ({ kind: PackageKind.Library, id: d, version: ComposeFx.Version })));
        assert.ok(out.ok, JSON.stringify(out.errors));
        this.documents.set(id, out.package!.document);
        await this.Storage.WriteText(`${id}/${ComposeFx.Version}/model.json`, JSON.stringify(out.package!.document));
        return this;
    }

    public Ref(id: string): Required<PackageRef>
    {
        return { model: id, version: ComposeFx.Version };
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

/** A stand-in external connector serving one fixed row per fetch (DataSourceConnector, Task 3, is the real one). */
class FixedRowConnector implements IExternalConnector
{
    private static readonly ReadOnly = 'read-only';

    public readonly Residency = ConnectorResidency.External as const;
    public readonly Capabilities = { KeyLookup: false, ReverseLookup: false, PushDown: new Set<never>() };
    public readonly Name: string;

    public constructor(private readonly plan: IExternalConnectorPlan, private readonly catalog: IEnvironmentCatalog)
    {
        this.Name = plan.Name;
    }

    public async Fetch(request: IFetchRequest): Promise<IFetchPage>
    {
        const binding = this.plan.Bindings.find((b) => b.Model === request.Model && b.Binding.Concept === request.Concept);
        if (binding === undefined) return { Rows: [] };
        return {
            Rows: [{
                PublicId: this.catalog.Identity.Mint(binding, '42'),
                Concept: binding.Binding.Concept,
                Values: new Map([['name', 'Ada']]),
                Links: new Map(),
            }],
        };
    }

    public Begin(): Promise<IConnectorTransaction>
    {
        return Promise.reject(new Error(FixedRowConnector.ReadOnly));
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
        assert.equal(catalog.Description.DefaultConnector, 'engine');
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
        const first = await fx.Compose(fx.Deploy(ComposeFx.AppA, 'shop.a'), fx.Deploy('app-b', 'shop.b'));
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

    test('external bindings are described with their engine connector', async () =>
    {
        const fx = await new ComposeFx().Add('crm.p', ComposeFx.Crm);
        const catalog = await fx.Compose(fx.Deploy(ComposeFx.AppA, 'crm.p'));
        assert.deepEqual(catalog.Description.Bindings, [{ Model: 'crm.p', Concept: 'crm.Customer', Connector: 'crm@connector:crm' }]);
        assert.deepEqual(catalog.Connectors.map((c) => [c.Name, c.Spec.Kind, c.Bindings.map((b) => [b.Model, b.Connector, b.Binding.Concept])]),
            [['crm@connector:crm', DataSourceKind.Sql, [['crm.p', 'crm@connector:crm', 'crm.Customer']]]]);
        assert.deepEqual(catalog.Identity.Bindings(), catalog.Connectors[0]!.Bindings);
        assert.equal(catalog.Identity.Mint(catalog.Connectors[0]!.Bindings[0]!, '7'), 'crm.Customer#crm@connector:crm.Customer#7');
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
        assert.equal(error.Subject, 'crm@connector:crm');
        assert.deepEqual(error.Deliveries, [ComposeFx.AppA, ComposeFx.SetB]);
        // The same spec declared twice is one connector.
        const same = await (await new ComposeFx().Add('p.one', one)).Add('p.two', two.replace('"two"', '"one"'));
        const catalog = await same.Compose(same.Deploy(ComposeFx.AppA, 'p.one', 'p.two'));
        assert.deepEqual(catalog.Connectors.map((c) => [c.Name, c.Bindings.map((b) => b.Model)]), [['crm@connector:crm', ['p.one', 'p.two']]]);
    });

    test('duplicate external source is rejected', async () =>
    {
        const fx = await (await new ComposeFx().Add('p.one', ComposeFx.Crm)).Add('p.two', ComposeFx.Crm);
        const error = await fx.Rejects(EnvironmentCatalogErrorCode.DuplicateExternalSource, fx.Deploy(ComposeFx.AppA, 'p.one'), fx.Deploy('app-c', 'p.two'));
        assert.match(error.Subject, /crm\.Customer/);
        assert.deepEqual(error.Deliveries, [ComposeFx.AppA, 'app-c']);
    });

    test('reserved connector name is rejected', () =>
    {
        for (const name of [BindingTable.EngineStorage, TodlNames.FileConnector])
        {
            assert.throws(() => ConnectorPlanMerge.Merge([
                ComposeFx.Plan('pkg.a', { Connectors: [{ Name: name, Kind: DataSourceKind.Sql, Config: {} }], Bindings: [ComposeFx.Binding('a.Cust', name)] }),
            ], new Map([['pkg.a', [ComposeFx.AppA]]])), (error: unknown) =>
                error instanceof EnvironmentCatalogError && error.Code === EnvironmentCatalogErrorCode.ReservedConnectorName
                && error.Subject === name && error.Deliveries.length === 1 && error.Deliveries[0] === ComposeFx.AppA);
        }
    });

    test('conflicting definition is rejected', async () =>
    {
        const fx = await (await new ComposeFx().Add('p.one', 'namespace acme { concept Customer { name : string?; } }'))
            .Add('p.two', 'namespace acme { concept Customer { age : integer?; } }');
        const error = await fx.Rejects(EnvironmentCatalogErrorCode.ConflictingDefinition, fx.Deploy(ComposeFx.AppA, 'p.one'), fx.Promote(ComposeFx.SetB, 'p.two'));
        assert.equal(error.Subject, 'acme.Customer');
        assert.deepEqual(error.Deliveries, [ComposeFx.AppA, ComposeFx.SetB]);
        assert.match(error.message, /acme\.Customer/);
    });

    test('runtime compiles nothing', async () =>
    {
        const fx = await (await (await new ComposeFx().Add('crm.p', ComposeFx.Crm)).Add('shop.a', ComposeFx.ShopA)).Add('shop.b', ComposeFx.ShopB);
        await assert.rejects(fx.Storage.ReadText('x/1.0.0/src/x.todl'), /source file/);
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
        const engine = await GraphEngine.Open({
            Description: catalog.Description,
            Storage: { Kind: StorageKind.Memory },
            Connectors: catalog.Connectors.map((plan) => new FixedRowConnector(plan, catalog)),
        });
        try
        {
            const cypher = new Cypher.CypherEngine(engine);
            const external = await cypher.Execute(AccessScope.System, 'MATCH (c:crm.Customer) RETURN c.name');
            assert.deepEqual(ComposeFx.Scalars(external.Rows), ['Ada']);
            const stored = await cypher.Execute(AccessScope.System, 'MATCH (o:shopa.Order) RETURN o.total');
            assert.deepEqual(ComposeFx.Scalars(stored.Rows), ['1']);
        }
        finally
        {
            await engine.dispose();
        }
    });
});
