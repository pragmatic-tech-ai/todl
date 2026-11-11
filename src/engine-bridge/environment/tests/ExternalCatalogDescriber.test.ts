import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { BindingTable } from '@pragmatic-tech-ai/graph';
import { Domain } from '../../../domain/domain.js';
import type { MetadataSnapshot } from '../../../domain/metadata-snapshot.js';
import { MemoryPackageSource } from '../../../domain/memory-package-source.js';
import { DataSourceKind, WriteAtomicity, WriteConcurrency, type ConnectorBinding, type ConnectorSpec, type ModelConnectorPlan } from '../../../model-data/connector-plan.js';
import { compilePackage } from '../../../publish/publish.js';
import { PackageManifestBridge } from '../../../solution-services/package-manager/package-manifest-bridge.js';
import { TodlNames } from '../../TodlNames.js';
import { EnvironmentCatalogError, EnvironmentCatalogErrorCode } from '../EnvironmentCatalogError.js';
import { ExternalCatalogDescriber } from '../ExternalCatalogDescriber.js';

class DescriberFx
{
    public static readonly Model = 'crm.lib';
    public static readonly Version = '1.0.0';
    public static readonly Source = 'namespace crm { concept Customer { name : string?; } }';
    public static readonly Customer = 'crm.Customer';
    public static readonly Delivery = 'app-a';
    public static readonly SqlId = 'crm@connector:crm';
    public static readonly Key = '42';

    public static async Snapshot(): Promise<MetadataSnapshot>
    {
        const out = compilePackage([], [{ uri: 'crm.todl', text: DescriberFx.Source }], { id: DescriberFx.Model, version: DescriberFx.Version });
        assert.ok(out.ok, JSON.stringify(out.errors));
        const domain = new Domain(new MemoryPackageSource([PackageManifestBridge.toResolved(out.package!)]));
        await domain.load({ model: DescriberFx.Model, version: DescriberFx.Version });
        return domain.Snapshot;
    }

    public static Sql(extra: Partial<ConnectorSpec> = {}): ConnectorSpec
    {
        return { Id: DescriberFx.SqlId, Name: 'crm', Kind: DataSourceKind.Sql, Connection: 'crm-db', Config: {}, ...extra };
    }

    public static Binding(connector: string, extra: Partial<ConnectorBinding> = {}): ConnectorBinding
    {
        return {
            Concept: DescriberFx.Customer, Connector: connector, Source: 'Customer', IdKey: 'id', FieldMap: { name: 'full_name' }, Writable: true,
            Concurrency: WriteConcurrency.LastWriteWins, Atomicity: WriteAtomicity.Sequential, ...extra,
        };
    }

    public static Plan(connectors: ConnectorSpec[], bindings: ConnectorBinding[]): ModelConnectorPlan
    {
        return { Model: DescriberFx.Model, Version: DescriberFx.Version, Connectors: connectors, Bindings: bindings };
    }

    public static Error(run: () => unknown, code: EnvironmentCatalogErrorCode): EnvironmentCatalogError
    {
        try
        {
            run();
        }
        catch (e)
        {
            assert.ok(e instanceof EnvironmentCatalogError, String(e));
            assert.equal(e.Code, code);
            return e;
        }
        return assert.fail('expected EnvironmentCatalogError');
    }
}

describe('ExternalCatalogDescriber', () =>
{
    test('routes builtin bindings to the local connector', async () =>
    {
        const snapshot = await DescriberFx.Snapshot();
        const plans = [DescriberFx.Plan([], [DescriberFx.Binding(TodlNames.FileConnector)])];
        const bound = (local: string) => ExternalCatalogDescriber.Describe(snapshot, plans, { DefaultConnector: BindingTable.EngineStorage, LocalConnector: local })
            .Description.Bindings.find((b) => b.Concept === DescriberFx.Customer)?.Connector;
        assert.equal(bound(TodlNames.FileConnector), TodlNames.FileConnector);
        assert.equal(bound(BindingTable.EngineStorage), BindingTable.EngineStorage);
    });

    test('external binding is described and planned', async () =>
    {
        const snapshot = await DescriberFx.Snapshot();
        const plans = [DescriberFx.Plan([DescriberFx.Sql()], [DescriberFx.Binding('crm', { ConnectorId: DescriberFx.SqlId })])];
        const catalog = ExternalCatalogDescriber.Describe(snapshot, plans, { DefaultConnector: BindingTable.EngineStorage, LocalConnector: BindingTable.EngineStorage });
        assert.deepEqual(catalog.Connectors.map((c) => c.Name), [DescriberFx.SqlId]);
        assert.ok(catalog.External.has(DescriberFx.Customer));
        assert.equal(catalog.Description.Bindings.find((b) => b.Concept === DescriberFx.Customer)?.Connector, DescriberFx.SqlId);
        const binding = catalog.Connectors[0]!.Bindings[0]!;
        const id = catalog.Identity.Mint(binding, DescriberFx.Key);
        assert.ok(id.endsWith(DescriberFx.Key));
        assert.equal(catalog.Identity.Parse(id)?.StorageId, DescriberFx.Key);
    });

    test('unknown connector is rejected', async () =>
    {
        const snapshot = await DescriberFx.Snapshot();
        const plans = [DescriberFx.Plan([], [DescriberFx.Binding('nowhere')])];
        DescriberFx.Error(() => ExternalCatalogDescriber.Describe(snapshot, plans, { DefaultConnector: BindingTable.EngineStorage, LocalConnector: BindingTable.EngineStorage }),
            EnvironmentCatalogErrorCode.UnknownConnector);
    });

    test('errors name the given deliveries', async () =>
    {
        const snapshot = await DescriberFx.Snapshot();
        const plans = [DescriberFx.Plan([], [DescriberFx.Binding('nowhere')])];
        const error = DescriberFx.Error(() => ExternalCatalogDescriber.Describe(snapshot, plans, {
            DefaultConnector: BindingTable.EngineStorage, LocalConnector: BindingTable.EngineStorage, Deliveries: new Map([[DescriberFx.Model, [DescriberFx.Delivery]]]),
        }), EnvironmentCatalogErrorCode.UnknownConnector);
        assert.deepEqual(error.Deliveries, [DescriberFx.Delivery]);
        assert.ok(error.message.includes(DescriberFx.Delivery));
    });
});
