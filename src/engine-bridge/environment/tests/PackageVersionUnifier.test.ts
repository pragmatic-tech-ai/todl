import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Domain, type PackageRef } from '../../../domain/domain.js';
import { MemoryPackageSource } from '../../../domain/memory-package-source.js';
import { compilePackage, PackageKind, type PackageDocument } from '../../../publish/publish.js';
import { PackageManifestBridge } from '../../../solution-services/package-manager/package-manifest-bridge.js';
import { DeliveryChannel, type IPackageDelivery } from '../EnvironmentCatalogComposer.js';
import { EnvironmentCatalogError, EnvironmentCatalogErrorCode } from '../EnvironmentCatalogError.js';
import { PackageVersionUnifier } from '../PackageVersionUnifier.js';
import { UnifiedPackageSource } from '../UnifiedPackageSource.js';

/** Packages compiled in memory, one per (model, version), with optional dependencies. */
class UnifierFx
{
    public static readonly AppA = 'app-a';
    public static readonly AppB = 'app-b';

    private readonly source = new MemoryPackageSource();
    private readonly documents: PackageDocument[] = [];

    public Add(model: string, version: string, text: string, deps: readonly Required<PackageRef>[] = [], bases: readonly UnifierFx[] = []): this
    {
        const documents = bases.flatMap((b) => b.documents);
        const out = compilePackage(documents, [{ uri: `${model}.todl`, text }], { id: model, version },
            deps.map((d) => ({ kind: PackageKind.Library, id: d.model, version: d.version })));
        assert.ok(out.ok, JSON.stringify(out.errors));
        this.source.Add(PackageManifestBridge.toResolved(out.package!));
        this.documents.push(out.package!.document);
        return this;
    }

    public get Source(): MemoryPackageSource
    {
        return this.source;
    }

    public static Delivery(name: string, ...packages: Required<PackageRef>[]): IPackageDelivery
    {
        return { Channel: DeliveryChannel.Deploy, Name: name, Packages: packages };
    }

    public static readonly Crm = 'namespace crm { concept Customer { name : string?; } }';

    public static async Rejects(fx: UnifierFx, deliveries: readonly IPackageDelivery[]): Promise<EnvironmentCatalogError>
    {
        let caught: unknown;
        try
        {
            await PackageVersionUnifier.Unify(deliveries, fx.Source);
        }
        catch (error)
        {
            caught = error;
        }
        assert.ok(caught instanceof EnvironmentCatalogError, String(caught));
        return caught;
    }
}

describe('PackageVersionUnifier (T11)', () =>
{
    test('same major picks highest', async () =>
    {
        const fx = new UnifierFx().Add('crm', '1.2.0', UnifierFx.Crm).Add('crm', '1.4.1', UnifierFx.Crm);
        const chosen = await PackageVersionUnifier.Unify([
            UnifierFx.Delivery(UnifierFx.AppA, { model: 'crm', version: '1.2.0' }),
            UnifierFx.Delivery(UnifierFx.AppB, { model: 'crm', version: '1.4.1' }),
        ], fx.Source);
        assert.deepEqual([...chosen], [['crm', '1.4.1']]);
    });

    test('incompatible majors are rejected', async () =>
    {
        const fx = new UnifierFx().Add('crm', '1.2.0', UnifierFx.Crm).Add('crm', '2.0.0', UnifierFx.Crm);
        const error = await UnifierFx.Rejects(fx, [
            UnifierFx.Delivery(UnifierFx.AppA, { model: 'crm', version: '1.2.0' }),
            UnifierFx.Delivery(UnifierFx.AppB, { model: 'crm', version: '2.0.0' }),
        ]);
        assert.equal(error.Code, EnvironmentCatalogErrorCode.IncompatibleVersions);
        assert.equal(error.Subject, 'crm');
        assert.deepEqual(error.Deliveries, [UnifierFx.AppA, UnifierFx.AppB]);
        assert.match(error.message, /crm/);
        assert.match(error.message, /1\.2\.0/);
        assert.match(error.message, /2\.0\.0/);
        assert.match(error.message, /app-a/);
        assert.match(error.message, /app-b/);
    });

    test('zero major needs same minor', async () =>
    {
        const fx = new UnifierFx().Add('crm', '0.3.1', UnifierFx.Crm).Add('crm', '0.4.0', UnifierFx.Crm).Add('crm', '0.3.7', UnifierFx.Crm);
        const error = await UnifierFx.Rejects(fx, [
            UnifierFx.Delivery(UnifierFx.AppA, { model: 'crm', version: '0.3.1' }),
            UnifierFx.Delivery(UnifierFx.AppB, { model: 'crm', version: '0.4.0' }),
        ]);
        assert.equal(error.Code, EnvironmentCatalogErrorCode.IncompatibleVersions);
        const chosen = await PackageVersionUnifier.Unify([
            UnifierFx.Delivery(UnifierFx.AppA, { model: 'crm', version: '0.3.1' }),
            UnifierFx.Delivery(UnifierFx.AppB, { model: 'crm', version: '0.3.7' }),
        ], fx.Source);
        assert.deepEqual([...chosen], [['crm', '0.3.7']]);
    });

    test('non-semver must be equal', async () =>
    {
        const fx = new UnifierFx().Add('crm', 'dev', UnifierFx.Crm).Add('crm', '1.0.0', UnifierFx.Crm).Add('crm', 'dev-2', UnifierFx.Crm);
        const same = await PackageVersionUnifier.Unify([
            UnifierFx.Delivery(UnifierFx.AppA, { model: 'crm', version: 'dev' }),
            UnifierFx.Delivery(UnifierFx.AppB, { model: 'crm', version: 'dev' }),
        ], fx.Source);
        assert.deepEqual([...same], [['crm', 'dev']]);
        for (const other of ['1.0.0', 'dev-2'])
        {
            const error = await UnifierFx.Rejects(fx, [
                UnifierFx.Delivery(UnifierFx.AppA, { model: 'crm', version: 'dev' }),
                UnifierFx.Delivery(UnifierFx.AppB, { model: 'crm', version: other }),
            ]);
            assert.equal(error.Code, EnvironmentCatalogErrorCode.IncompatibleVersions);
        }
    });

    test('dependency versions are unified', async () =>
    {
        const base10 = new UnifierFx().Add('base', '1.0.0', 'namespace base { concept Cust { name : string?; } }');
        const fx = new UnifierFx()
            .Add('base', '1.0.0', 'namespace base { concept Cust { name : string?; } }')
            .Add('base', '1.3.0', 'namespace base { concept Cust { name : string?; age : integer?; } }')
            .Add('ui', '1.0.0', 'namespace ui { import base; concept Order { cust : base.Cust?; } }', [{ model: 'base', version: '1.0.0' }], [base10]);
        const chosen = await PackageVersionUnifier.Unify([
            UnifierFx.Delivery(UnifierFx.AppA, { model: 'ui', version: '1.0.0' }),
            UnifierFx.Delivery(UnifierFx.AppB, { model: 'base', version: '1.3.0' }),
        ], fx.Source);
        assert.deepEqual([...chosen].sort(), [['base', '1.3.0'], ['ui', '1.0.0']]);
        const domain = new Domain(new UnifiedPackageSource(fx.Source, chosen));
        await domain.load({ model: 'ui', version: '1.0.0' });
        assert.deepEqual(domain.manifests.map((m) => `${m.model}@${m.version}`), ['base@1.3.0', 'ui@1.0.0']);
    });

    test('a superseded version\'s dependencies are still checked', async () =>
    {
        const lib1 = new UnifierFx().Add('lib', '1.0.0', 'namespace lib { concept L { } }');
        const fx = new UnifierFx()
            .Add('lib', '1.0.0', 'namespace lib { concept L { } }')
            .Add('lib', '2.0.0', 'namespace lib { concept L { } }')
            .Add('ui', '1.0.0', 'namespace ui { concept U { } }', [{ model: 'lib', version: '1.0.0' }], [lib1])
            .Add('ui', '1.1.0', 'namespace ui { concept U { } }');
        const error = await UnifierFx.Rejects(fx, [
            UnifierFx.Delivery(UnifierFx.AppA, { model: 'ui', version: '1.0.0' }),
            UnifierFx.Delivery(UnifierFx.AppB, { model: 'ui', version: '1.1.0' }, { model: 'lib', version: '2.0.0' }),
        ]);
        assert.equal(error.Subject, 'lib');
        assert.deepEqual(error.Deliveries, [UnifierFx.AppA, UnifierFx.AppB]);
    });
});
