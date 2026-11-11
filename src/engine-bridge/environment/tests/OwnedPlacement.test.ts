import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { AccessDefault, AccessError, AccessErrorCode, AccessScope, Cypher, GraphEngine, Predicate, StorageKind, type CellValue } from '@pragmatic-tech-ai/graph';
import type { IPrincipalFacts } from '../../PrincipalFacts.js';
import { EngineBridgeError, EngineBridgeErrorCode } from '../../EngineBridgeError.js';
import { SystemFieldGuard } from '../../system/SystemFieldGuard.js';
import { SystemNames } from '../../system/SystemNames.js';
import type { IEnvironmentCatalog } from '../EnvironmentCatalogComposer.js';
import { EnvironmentNodePlacement } from '../EnvironmentNodePlacement.js';
import { SecFx, type ISecPackage } from './SecFx.js';

/** One environment engine composed from security fixture packages, creating nodes as the fixture principal. */
class OwnedFx
{
    public static readonly NewId = 'e-1';
    public static readonly EdgeConcept = 'hr.Assignment';
    public static readonly FromMember = 'employee';
    public static readonly ToMember = 'project';
    public static readonly Employee = 'hr.Employee';
    public static readonly Principal: IPrincipalFacts = { Id: 'u-alice', HomeBusinessUnitId: 'bu-sales' };

    private constructor(
        public readonly Catalog: IEnvironmentCatalog,
        public readonly Engine: GraphEngine,
        public readonly Cypher: Cypher.CypherEngine,
    )
    {
    }

    public static async Open(packages: readonly ISecPackage[]): Promise<OwnedFx>
    {
        const catalog = await SecFx.Compose(packages);
        const engine = await GraphEngine.Open({ Description: catalog.Description, Storage: { Kind: StorageKind.Memory } });
        return new OwnedFx(catalog, engine, new Cypher.CypherEngine(engine));
    }

    /** Runs `text` with `scope` and the environment placement, every create taking NewId. */
    public static Run(fx: OwnedFx, scope: AccessScope, text: string): Promise<Cypher.CypherResult>
    {
        return fx.Cypher.Execute(scope, text, { Placement: fx.Placement() });
    }

    public Placement(): EnvironmentNodePlacement
    {
        return new EnvironmentNodePlacement(this.Catalog.Identity, this.Catalog.HomeModels, this.Catalog.Security.OwnedConcepts(),
            OwnedFx.Principal, () => OwnedFx.NewId);
    }

    public async Read(member: string): Promise<CellValue | undefined>
    {
        const reader = await this.Engine.BeginRead(AccessScope.System);
        try
        {
            return await reader.GetProperty(OwnedFx.NewId, member);
        }
        finally
        {
            reader.dispose();
        }
    }

    /** Opens the environment of `packages`, runs `body` against it, and disposes the engine. */
    public static async With(packages: readonly ISecPackage[], body: (fx: OwnedFx) => Promise<void>): Promise<void>
    {
        const fx = await OwnedFx.Open(packages);
        try
        {
            await body(fx);
        }
        finally
        {
            await fx.Engine.dispose();
        }
    }
}

describe('OwnedPlacement', () =>
{
    test('CREATE of an owned concept places owner and owning BU', () => OwnedFx.With([SecFx.Hr], async (fx) =>
    {
        await OwnedFx.Run(fx, SystemFieldGuard.Guard(AccessScope.System), "CREATE (:hr.Employee {name: 'Ann'})");
        assert.equal(await fx.Read(SystemNames.Owner), OwnedFx.Principal.Id);
        assert.equal(await fx.Read(SystemNames.OwningBusinessUnit), OwnedFx.Principal.HomeBusinessUnitId);
    }));

    for (const [name, text] of <readonly (readonly [string, string])[]>[
        ['CREATE setting owner is refused even under System', "CREATE (:hr.Employee {name: 'Ann', owner: 'x'})"],
        ['MERGE that creates with owningBusinessUnit is refused', "MERGE (:hr.Employee {name: 'Ann', owningBusinessUnit: 'bu-x'})"],
    ])
    {
        test(name, () => OwnedFx.With([SecFx.Hr], async (fx) =>
        {
            await assert.rejects(OwnedFx.Run(fx, AccessScope.System, text),
                (e: unknown) => e instanceof EngineBridgeError && e.Code === EngineBridgeErrorCode.SystemFieldWrite);
            assert.equal(await fx.Read(SystemNames.Owner), undefined);
        }));
    }

    test('SET owner under a guarded scope is MemberReadOnly', () => OwnedFx.With([SecFx.Hr], async (fx) =>
    {
        const guarded = SystemFieldGuard.Guard(AccessScope.System);
        await OwnedFx.Run(fx, guarded, "CREATE (:hr.Employee {name: 'Ann'})");
        await assert.rejects(OwnedFx.Run(fx, guarded, "MATCH (e:hr.Employee) SET e.owner = 'x'"),
            (e: unknown) => e instanceof Cypher.CypherWriteError && e.cause instanceof AccessError && e.cause.Code === AccessErrorCode.MemberReadOnly);
        assert.equal(await fx.Read(SystemNames.Owner), OwnedFx.Principal.Id);
    }));

    for (const [name, text, member] of <readonly (readonly [string, string, string])[]>[
        ['CREATE then SET owner under a guarded scope', "CREATE (n:hr.Employee {name: 'Ann'}) SET n.owner = 'x'", SystemNames.Owner],
        ['MERGE ON CREATE SET owner under a guarded scope', "MERGE (n:hr.Employee {name: 'Ann'}) ON CREATE SET n.owner = 'x'", SystemNames.Owner],
        ['CREATE then SET owningBusinessUnit on a dependent-package concept', "CREATE (n:hrext.Contractor {name: 'Cy'}) SET n.owningBusinessUnit = 'bu-x'",
            SystemNames.OwningBusinessUnit],
    ])
    {
        test(`${name} is MemberReadOnly and stores nothing`, () => OwnedFx.With([SecFx.Hr, SecFx.HrExt], async (fx) =>
        {
            await assert.rejects(OwnedFx.Run(fx, SystemFieldGuard.Guard(AccessScope.System), text),
                (e: unknown) => e instanceof Cypher.CypherWriteError && e.cause instanceof AccessError && e.cause.Code === AccessErrorCode.MemberReadOnly);
            assert.equal(await fx.Read(member), undefined);
        }));
    }

    test('an unowned concept gets no system defaults', () => OwnedFx.With([SecFx.Hr, SecFx.ProjectsWithAssignment], async (fx) =>
    {
        assert.equal(fx.Placement().Place('projects.Person', new Map()).Defaults, undefined);
    }));

    test("a dependent package's subconcept of an owned concept gets an owner", () => OwnedFx.With([SecFx.Hr, SecFx.HrExt], async (fx) =>
    {
        await OwnedFx.Run(fx, SystemFieldGuard.Guard(AccessScope.System), "CREATE (:hrext.Contractor {name: 'Cy'})");
        assert.equal(await fx.Read(SystemNames.Owner), OwnedFx.Principal.Id);
        assert.equal(await fx.Read(SystemNames.OwningBusinessUnit), OwnedFx.Principal.HomeBusinessUnitId);
    }));

    test('Guard(System) still reads unrestricted', () => assert.equal(SystemFieldGuard.Guard(AccessScope.System).ReadsUnrestricted, true));

    test('Guard keeps the Endpoints and the Append/AppendTo rules of every Writes entry', () =>
    {
        const append = Predicate.True;
        const appendTo = Predicate.False;
        const scope = AccessScope.Build({
            Default: AccessDefault.Allow,
            Endpoints: new Map([[OwnedFx.EdgeConcept, { From: OwnedFx.FromMember, To: OwnedFx.ToMember }]]),
            Writes: new Map([[SystemNames.Owned, { Append: append, AppendTo: appendTo }], [OwnedFx.Employee, { AppendTo: appendTo }]]),
        });
        const guarded = SystemFieldGuard.Guard(scope);
        assert.deepEqual(guarded.Endpoints.get(OwnedFx.EdgeConcept), { From: OwnedFx.FromMember, To: OwnedFx.ToMember });
        const owned = guarded.Writes.get(SystemNames.Owned)!;
        assert.equal(owned.Append, append);
        assert.equal(owned.AppendTo, appendTo);
        assert.deepEqual(owned.ReadOnly?.Update, new Set(SystemNames.SystemFields));
        assert.equal(guarded.Writes.get(OwnedFx.Employee)!.AppendTo, appendTo);
    });
});
