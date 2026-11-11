import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MemberKind, ValueType, type IDefinitionDescription } from '@pragmatic-tech-ai/graph';
import { compilePackage } from '../../../publish/publish.js';
import { PackageManifestBridge } from '../../../solution-services/package-manager/package-manifest-bridge.js';
import { Domain, type ResolvedPackage } from '../../../domain/domain.js';
import { MemoryPackageSource } from '../../../domain/memory-package-source.js';
import { EngineFixture } from '../../tests/EngineFixture.js';
import { TodlNames } from '../../TodlNames.js';
import { SystemPackage } from '../SystemPackage.js';
import { ShareGrants } from '../ShareGrants.js';
import { SystemNames } from '../SystemNames.js';

/** Describes resolved packages through the normal Domain path. */
class SystemFx
{
    public static readonly SourceUri = 'system.todl';
    public static readonly Utf8 = 'utf8';
    public static readonly Source = readFileSync(fileURLToPath(new URL('../system.todl', import.meta.url)), SystemFx.Utf8);
    public static readonly OtherModel = 'other';
    public static readonly OtherVersion = '2.0.0';

    public static async Definitions(resolved: ResolvedPackage): Promise<readonly IDefinitionDescription[]>
    {
        const domain = new Domain(new MemoryPackageSource([resolved]));
        await domain.load(resolved.ref);
        const description = EngineFixture.Describe(domain.Snapshot);
        assert.deepEqual(description.Diagnostics, []);
        return description.Description.Definitions;
    }

    public static FreshCompile(): ResolvedPackage
    {
        const ref = SystemPackage.Ref;
        const out = compilePackage([], [{ uri: SystemFx.SourceUri, text: SystemFx.Source }], { id: ref.model, version: ref.version });
        assert.ok(out.ok, JSON.stringify(out.errors));
        return PackageManifestBridge.toResolvedJsonDocument(out.package!.document, ref.model, ref.version, []);
    }
}

describe('SystemPackage (ruling T10)', () =>
{
    test('generated system package is current', async () =>
    {
        const generated = await SystemFx.Definitions(await new SystemPackage().resolve(SystemPackage.Ref));
        const fresh = await SystemFx.Definitions(SystemFx.FreshCompile());
        assert.deepEqual(generated, fresh);
    });

    test('system package describes ShareGrant', async () =>
    {
        const definitions = await SystemFx.Definitions(await new SystemPackage().resolve(SystemPackage.Ref));
        const grant = definitions.find((d) => d.Name === SystemNames.ShareGrant);
        assert.ok(grant !== undefined);
        const member = (name: string) => grant.Members.find((m) => m.Name === name);
        const record = member(SystemNames.Record);
        assert.equal(record?.Kind, MemberKind.Relationship);
        assert.deepEqual(record.Kind === MemberKind.Relationship ? [...(record.Targets ?? [])] : undefined, [TodlNames.Element]);
        assert.equal(record.Kind === MemberKind.Relationship ? record.Many : undefined, false);
        for (const name of [SystemNames.SubjectKind, SystemNames.SubjectId])
        {
            const m = member(name);
            assert.equal(m?.Kind, MemberKind.Property, name);
            assert.equal(m.Kind === MemberKind.Property ? m.Type : undefined, ValueType.String, name);
        }
        for (const name of ShareGrants.Rights)
        {
            const m = member(name);
            assert.equal(m?.Kind, MemberKind.Property, name);
            assert.equal(m.Kind === MemberKind.Property ? m.Type : undefined, ValueType.Boolean, name);
            assert.equal(m.Kind === MemberKind.Property ? m.Nullable : undefined, true, name);
        }
    });

    test('the package document is served for the system ref only, as a copy', async () =>
    {
        const source = new SystemPackage();
        const first = await source.Document(SystemPackage.Ref);
        first.nodes.length = 0;
        const second = await source.Document(SystemPackage.Ref);
        assert.ok(second.nodes.length > 0);
        assert.deepEqual(await source.versions(SystemPackage.Ref.model), [SystemPackage.Ref.version]);
        await assert.rejects(source.resolve({ model: SystemFx.OtherModel }));
        await assert.rejects(source.Document({ model: SystemPackage.Ref.model, version: SystemFx.OtherVersion }));
    });
});
