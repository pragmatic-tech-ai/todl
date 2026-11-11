import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { AccessScope, Cypher, GraphEngine, StorageKind } from '@pragmatic-tech-ai/graph';
import { SystemNames } from '../../system/SystemNames.js';
import { EnvironmentCatalogErrorCode } from '../EnvironmentCatalogError.js';
import { EnvironmentNodePlacement } from '../EnvironmentNodePlacement.js';
import { SecFx } from './SecFx.js';

describe('EnvironmentSecurity', () =>
{
    test("catalog carries every delivered package's security, keyed by model", async () =>
    {
        const catalog = await SecFx.Compose([SecFx.Hr, SecFx.Projects]);
        assert.deepEqual([...catalog.Security.Packages.keys()].sort(), ['hr', 'projects', 'todl.system']);
        assert.deepEqual(catalog.Security.Packages.get('hr')!.SecuredFields, [{ Concept: 'hr.Employee', Field: 'NationalId' }, { Concept: 'hr.Employee', Field: 'Salary' }]);
        assert.ok(catalog.Security.OwnedConcepts().has('projects.Task'));
    });

    test('system concepts home to todl.system even when an app sorts first', async () =>
    {
        const catalog = await SecFx.Compose([SecFx.Named('aaa', SecFx.HrSource)]);
        assert.equal(catalog.HomeModels.get(SystemNames.ShareGrant), SystemNames.Model);
        assert.ok(!catalog.HomeModels.has(SystemNames.Owned) || catalog.HomeModels.get(SystemNames.Owned) === SystemNames.Model);
        assert.ok(catalog.Description.Definitions.some((d) => d.Name === SystemNames.Owned));
        const placement = new EnvironmentNodePlacement(catalog.Identity, catalog.HomeModels, new Set(), SecFx.Principal, () => SecFx.GrantId);
        assert.equal(placement.Place(SystemNames.ShareGrant, new Map()).Owner, SystemNames.Model);
        const engine = await GraphEngine.Open({ Description: catalog.Description, Storage: { Kind: StorageKind.Memory } });
        try
        {
            await new Cypher.CypherEngine(engine).Execute(AccessScope.System, SecFx.CreateGrant, { Placement: placement });
            const reader = await engine.BeginRead(AccessScope.System);
            try
            {
                assert.equal(await reader.OwnerOf(SecFx.GrantId), SystemNames.Model);
            }
            finally
            {
                reader.dispose();
            }
        }
        finally
        {
            await engine.dispose();
        }
    });

    test("a dependent package's subconcept of an owned concept composes from storage and is owned", async () =>
    {
        const catalog = await SecFx.Compose([SecFx.Hr, SecFx.HrExt]);
        assert.ok(catalog.Security.Packages.get('hrext')!.OwnedConcepts.includes('hrext.Contractor'));
        assert.ok(catalog.Security.OwnedConcepts().has('hrext.Contractor'));
    });

    test('a subconcept compiled against a plain parent is owned once the environment unifies onto the owned parent', async () =>
    {
        const catalog = await SecFx.Compose([SecFx.HrExtOverPlain, SecFx.HrOwnedUpgrade], undefined, [SecFx.HrPlain, SecFx.HrExtOverPlain, SecFx.HrOwnedUpgrade]);
        assert.deepEqual(catalog.Security.Packages.get('hrext')!.OwnedConcepts, []);
        assert.ok(catalog.Security.OwnedConcepts().has('hrext.Contractor'));
    });

    test('re-composing after an upgrade replaces the security with the catalog', async () =>
    {
        const v1 = await SecFx.Compose([SecFx.Hr]);
        const v2 = await SecFx.Compose([SecFx.HrV2WithoutSalaryFlagAndRole]);
        assert.ok(v1.Security.Packages.get('hr')!.SecuredFields.some((f) => f.Field === 'Salary'));
        assert.ok(!v2.Security.Packages.get('hr')!.SecuredFields.some((f) => f.Field === 'Salary'));
        assert.deepEqual(v2.Security.Packages.get('hr')!.Roles, []);
    });

    test("environment security unions every package's edge concepts", async () =>
    {
        const catalog = await SecFx.Compose([SecFx.Hr, SecFx.ProjectsWithAssignment]);
        assert.deepEqual(catalog.Security.EdgeConcepts, [{ Concept: 'projects.Assignment', From: 'from', To: 'to' }]);
    });

    test('an owned concept populated from a connector by another package is SecuredExternalConcept', async () =>
    {
        await SecFx.Rejects(EnvironmentCatalogErrorCode.SecuredExternalConcept, 'hr.Employee', [SecFx.HrFeed, SecFx.HrOwnedUpgrade], undefined,
            [SecFx.HrPlain, SecFx.HrFeed, SecFx.HrOwnedUpgrade]);
    });

    test("a document whose security names another package's concept is ForeignSecurityConcept", async () =>
    {
        await SecFx.Rejects(EnvironmentCatalogErrorCode.ForeignSecurityConcept, 'hr.Employee', [SecFx.Hr, SecFx.Projects], (documents) =>
        {
            const projects = documents.get('projects')!;
            projects.security = { ...projects.security!, SecuredFields: [{ Concept: 'hr.Employee', Field: 'Salary' }] };
        });
    });
});
