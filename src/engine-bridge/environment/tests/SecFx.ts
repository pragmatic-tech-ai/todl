import assert from 'node:assert/strict';
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime';
import type { IPrincipalFacts } from '../../PrincipalFacts.js';
import { compilePackage, PackageKind, type PackageDocument } from '../../../publish/publish.js';
import { StoragePackageSource } from '../../../solution-services/package-manager/storage-package-source.js';
import { EnvironmentCatalogComposer, type IEnvironmentCatalog } from '../EnvironmentCatalogComposer.js';
import { EnvironmentCatalogError, type EnvironmentCatalogErrorCode } from '../EnvironmentCatalogError.js';
import { DeliveryChannel } from '../PackageDelivery.js';

/** One package to compile: its model id, version, source text and the earlier packages it depends on. */
export interface ISecPackage
{
    readonly Id: string;
    readonly Version: string;
    readonly Text: string;
    readonly Dependencies: readonly ISecPackage[];
}

/** Security fixture packages compiled in the test and published as `<id>/<version>/model.json` into a FakeStorage. */
export class SecFx
{
    public static readonly Principal: IPrincipalFacts = { Id: 'u-fixture', HomeBusinessUnitId: 'bu-fixture' };
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
    /** A dependent package whose subconcept of hr's owned Employee is owned through its parent. */
    public static readonly HrExtSource = 'namespace hrext { concept Contractor : hr.Employee { agency : string?; } }';
    public static readonly CreateGrant = "CREATE (:todl.system.ShareGrant {subjectKind: 'principal', subjectId: 'p1'})";

    public static readonly Hr = SecFx.Named('hr', SecFx.HrSource);
    public static readonly HrV2WithoutSalaryFlagAndRole: ISecPackage = { ...SecFx.Named('hr', SecFx.HrV2Source), Version: SecFx.NextVersion };
    public static readonly Projects = SecFx.Named('projects', SecFx.ProjectsSource);
    public static readonly ProjectsWithAssignment = SecFx.Named('projects', SecFx.ProjectsWithAssignmentSource);
    public static readonly HrPlain = SecFx.Named('hr', SecFx.HrPlainSource);
    /** hr upgraded to the owned, secured Employee, which the environment unifies hrfeed's dependency onto. */
    public static readonly HrOwnedUpgrade: ISecPackage = { ...SecFx.Hr, Version: SecFx.NextVersion };
    public static readonly HrExt: ISecPackage = { ...SecFx.Named('hrext', SecFx.HrExtSource), Dependencies: [SecFx.Hr] };
    /** hrext compiled against the plain hr, which the environment unifies onto HrOwnedUpgrade. */
    public static readonly HrExtOverPlain: ISecPackage = { ...SecFx.Named('hrext', SecFx.HrExtSource), Dependencies: [SecFx.HrPlain] };
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
