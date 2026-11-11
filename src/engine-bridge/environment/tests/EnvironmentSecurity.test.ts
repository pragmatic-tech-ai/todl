import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { AccessScope, Cypher, GraphEngine, StorageKind } from '@pragmatic-tech-ai/graph';
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime';
import { compilePackage, PackageKind, type PackageDocument } from '../../../publish/publish.js';
import { StoragePackageSource } from '../../../solution-services/package-manager/storage-package-source.js';
import { SystemNames } from '../../system/SystemNames.js';
import { EnvironmentCatalogComposer, type IEnvironmentCatalog } from '../EnvironmentCatalogComposer.js';
import { EnvironmentCatalogError, EnvironmentCatalogErrorCode } from '../EnvironmentCatalogError.js';
import { EnvironmentNodePlacement } from '../EnvironmentNodePlacement.js';
import { DeliveryChannel } from '../PackageDelivery.js';

/** One package to compile: its model id, version, source text and the earlier packages it depends on. */
interface ISecPackage
{
    readonly Id: string;
    readonly Version: string;
    readonly Text: string;
    readonly Dependencies: readonly ISecPackage[];
}

/** Security fixture packages compiled in the test and published as `<id>/<version>/model.json` into a FakeStorage. */
class SecFx
{
    public static readonly Version = '1.0.0';
    public static readonly NextVersion = '1.1.0';
    public static readonly App = 'app';
    public static readonly GrantId = 'grant-1';
    public static readonly HrSource = `namespace hr
{
    concept Employee : todl.system.Owned { name : string; secured Salary : number?; secured NationalId : string?; }
    role HrManager { Employee { read = organization; update = businessUnit; } }
}`;
    public static readonly HrV2Source = 'namespace hr { concept Employee : todl.system.Owned { name : string; Salary : number?; secured NationalId : string?; } }';
    public static readonly ProjectsSource = `namespace projects
{
    concept Project : todl.system.Owned { name : string; }
    concept Task : todl.system.Owned { title : string; }
    role ProjectMember { Task { read = user; } }
}`;
    public static readonly ProjectsWithAssignmentSource = `namespace projects
{
    concept Person { name : string; }
    concept Project : todl.system.Owned { name : string; }
    concept Assignment { from : Person; to : Project; role : string?; }
    operator ==> : Assignment (from, to);
}`;
    /** hr before Employee was owned or secured. */
    public static readonly HrPlainSource = 'namespace hr { concept Employee { name : string; } }';
    /** A package over the plain hr that populates hr.Employee from a datasource of its own (legal when it compiled). */
    public static readonly HrFeedSource = `namespace hrfeed
{
    import hr;
    datasource feed { kind = sql; connection = "feed-db"; }
    model Feed : hrfeed { connect feed; populate hr.Employee key emp_id { name = "full_name"; } }
}`;
    public static readonly CreateGrant = "CREATE (:todl.system.ShareGrant {subjectKind: 'principal', subjectId: 'p1'})";

    public static readonly Hr = SecFx.Named('hr', SecFx.HrSource);
    public static readonly HrV2WithoutSalaryFlagAndRole: ISecPackage = { ...SecFx.Named('hr', SecFx.HrV2Source), Version: SecFx.NextVersion };
    public static readonly Projects = SecFx.Named('projects', SecFx.ProjectsSource);
    public static readonly ProjectsWithAssignment = SecFx.Named('projects', SecFx.ProjectsWithAssignmentSource);
    public static readonly HrPlain = SecFx.Named('hr', SecFx.HrPlainSource);
    /** hr upgraded to the owned, secured Employee, which the environment unifies hrfeed's dependency onto. */
    public static readonly HrOwnedUpgrade: ISecPackage = { ...SecFx.Hr, Version: SecFx.NextVersion };
    public static readonly HrFeed: ISecPackage = { ...SecFx.Named('hrfeed', SecFx.HrFeedSource), Dependencies: [SecFx.HrPlain] };

    public static Named(id: string, text: string): ISecPackage
    {
        return { Id: id, Version: SecFx.Version, Text: text, Dependencies: [] };
    }

    /**
     * Compiles every package (dependencies first) into a fresh storage, applies `tamper` to the stored documents (keyed
     * by model id), and composes one delivery of `delivered`.
     */
    public static async Compose(delivered: readonly ISecPackage[], tamper?: (documents: Map<string, PackageDocument>) => void,
        packages: readonly ISecPackage[] = delivered): Promise<IEnvironmentCatalog>
    {
        const storage = new FakeStorage();
        const compiled = new Map<ISecPackage, PackageDocument>();
        for (const p of packages)
        {
            const bases = p.Dependencies.map((d) => compiled.get(d)!);
            const out = compilePackage(bases, [{ uri: `${p.Id}.todl`, text: p.Text }], { id: p.Id, version: p.Version },
                p.Dependencies.map((d) => ({ kind: PackageKind.Library, id: d.Id, version: d.Version })));
            assert.ok(out.ok, JSON.stringify(out.errors));
            compiled.set(p, out.package!.document);
        }
        const byModel = new Map([...compiled].map(([p, document]) => [p.Id, document]));
        tamper?.(byModel);
        for (const [p, document] of compiled) await storage.WriteText(`${p.Id}/${p.Version}/model.json`, JSON.stringify(document));
        return EnvironmentCatalogComposer.Compose({
            Deliveries: [{ Channel: DeliveryChannel.Deploy, Name: SecFx.App, Packages: delivered.map((p) => ({ model: p.Id, version: p.Version })) }],
            Packages: new StoragePackageSource(storage),
        });
    }

    public static async Rejects(code: EnvironmentCatalogErrorCode, subject: string, delivered: readonly ISecPackage[],
        tamper?: (documents: Map<string, PackageDocument>) => void, packages: readonly ISecPackage[] = delivered): Promise<void>
    {
        await assert.rejects(SecFx.Compose(delivered, tamper, packages), (e: unknown) =>
        {
            assert.ok(e instanceof EnvironmentCatalogError, String(e));
            assert.equal(e.Code, code, e.message);
            assert.equal(e.Subject, subject);
            assert.deepEqual(e.Deliveries, [SecFx.App]);
            return true;
        });
    }
}

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
        const placement = new EnvironmentNodePlacement(catalog.Identity, catalog.HomeModels, () => SecFx.GrantId);
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
