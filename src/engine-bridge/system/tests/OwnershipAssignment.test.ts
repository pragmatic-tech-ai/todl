import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { AccessError, AccessErrorCode, AccessScope, Cypher, GraphEngine, StorageKind, type CellValue } from '@pragmatic-tech-ai/graph';
import { EngineBridgeError, EngineBridgeErrorCode } from '../../EngineBridgeError.js';
import type { IPrincipalFacts } from '../../PrincipalFacts.js';
import type { IEnvironmentCatalog } from '../../environment/EnvironmentCatalogComposer.js';
import { EnvironmentNodePlacement } from '../../environment/EnvironmentNodePlacement.js';
import { SecFx } from '../../environment/tests/SecFx.js';
import { OwnershipAssignment, type IOwnerAssignment } from '../OwnershipAssignment.js';
import { SystemFieldGuard } from '../SystemFieldGuard.js';
import { SystemNames } from '../SystemNames.js';

/** An environment engine holding one hr.Employee (EmployeeId, "Ann") and one unowned projects.Person (PersonId). */
class AssignFx
{
    public static readonly EmployeeId = 'e-1';
    public static readonly PersonId = 'p-1';
    public static readonly Principal: IPrincipalFacts = { Id: 'u-alice', HomeBusinessUnitId: 'bu-sales' };
    public static readonly NewOwner: IOwnerAssignment = { OwnerId: 'team-hr', BusinessUnitId: 'bu-hr' };

    private constructor(public readonly Catalog: IEnvironmentCatalog, public readonly Engine: GraphEngine)
    {
    }

    public static async With(body: (fx: AssignFx) => Promise<void>): Promise<void>
    {
        const catalog = await SecFx.Compose([SecFx.Hr, SecFx.ProjectsWithAssignment]);
        const engine = await GraphEngine.Open({ Description: catalog.Description, Storage: { Kind: StorageKind.Memory } });
        const fx = new AssignFx(catalog, engine);
        try
        {
            await fx.Create("CREATE (:hr.Employee {name: 'Ann'})", AssignFx.EmployeeId);
            await fx.Create("CREATE (:projects.Person {name: 'Pat'})", AssignFx.PersonId);
            await body(fx);
        }
        finally
        {
            await engine.dispose();
        }
    }

    public Assigner(): OwnershipAssignment
    {
        return new OwnershipAssignment(this.Catalog.Security.OwnedConcepts());
    }

    public async Read(id: string, member: string): Promise<CellValue | undefined>
    {
        const reader = await this.Engine.BeginRead(AccessScope.System);
        try
        {
            return await reader.GetProperty(id, member);
        }
        finally
        {
            reader.dispose();
        }
    }

    private async Create(text: string, id: string): Promise<void>
    {
        const placement = new EnvironmentNodePlacement(this.Catalog.Identity, this.Catalog.HomeModels, this.Catalog.Security.OwnedConcepts(),
            AssignFx.Principal, () => id);
        await new Cypher.CypherEngine(this.Engine).Execute(SystemFieldGuard.Guard(AccessScope.System), text, { Placement: placement });
    }
}

describe('OwnershipAssignment', () =>
{
    test('assign changes owner and owning BU and nothing else', () => AssignFx.With(async (fx) =>
    {
        const t = await fx.Engine.Begin(AccessScope.System);
        await fx.Assigner().Assign(t, AssignFx.EmployeeId, AssignFx.NewOwner);
        await t.Commit();
        assert.equal(await fx.Read(AssignFx.EmployeeId, SystemNames.Owner), 'team-hr');
        assert.equal(await fx.Read(AssignFx.EmployeeId, SystemNames.OwningBusinessUnit), 'bu-hr');
        assert.equal(await fx.Read(AssignFx.EmployeeId, 'name'), 'Ann');
    }));

    for (const [name, record, owner, code] of <readonly (readonly [string, string, IOwnerAssignment, EngineBridgeErrorCode])[]>[
        ['an unowned concept is NotOwned', AssignFx.PersonId, AssignFx.NewOwner, EngineBridgeErrorCode.NotOwned],
        ['a missing record is InvisibleRecord', 'missing-id', AssignFx.NewOwner, EngineBridgeErrorCode.InvisibleRecord],
        ['an empty owner id is UnsupportedValue', AssignFx.EmployeeId, { OwnerId: '', BusinessUnitId: 'bu-hr' }, EngineBridgeErrorCode.UnsupportedValue],
        ['an empty BU id is UnsupportedValue', AssignFx.EmployeeId, { OwnerId: 'team-hr', BusinessUnitId: '' }, EngineBridgeErrorCode.UnsupportedValue],
    ])
    {
        test(`assign on ${name} and names no record value`, () => AssignFx.With(async (fx) =>
        {
            const t = await fx.Engine.Begin(AccessScope.System);
            await assert.rejects(fx.Assigner().Assign(t, record, owner),
                (e: unknown) => e instanceof EngineBridgeError && e.Code === code && !e.message.includes(record) && !e.message.includes('Ann'));
            t.dispose();
        }));
    }

    test('a guarded transaction cannot assign', () => AssignFx.With(async (fx) =>
    {
        const t = await fx.Engine.Begin(SystemFieldGuard.Guard(AccessScope.System));
        await fx.Assigner().Assign(t, AssignFx.EmployeeId, AssignFx.NewOwner);
        await assert.rejects(t.Commit(), (e: unknown) => e instanceof AccessError && e.Code === AccessErrorCode.MemberReadOnly);
        assert.equal(await fx.Read(AssignFx.EmployeeId, SystemNames.Owner), AssignFx.Principal.Id);
    }));
});
