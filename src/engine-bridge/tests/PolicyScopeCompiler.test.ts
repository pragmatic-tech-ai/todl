import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    AccessDefault,
    AccessError,
    AccessErrorCode,
    AccessScope,
    GraphEngine,
    MemberKind,
    StorageKind,
    ValueType,
    type CellValue,
    type ISchemaDescription,
    type MemberInput,
} from '@pragmatic-tech-ai/graph';
import { check } from '../../compiler-services/api.js';
import { PolicyCompareOp, PolicyNodeKind, PolicyRefRoot } from '../../compiler-services/policy/policy-predicate.js';
import type { Scalar } from '../../manifest/logical.js';
import { PolicyDiagnosticCode, PolicyScopeCompiler } from '../PolicyScopeCompiler.js';
import type { IPrincipalFacts } from '../PrincipalFacts.js';

type FactMap = Record<string, Scalar | readonly Scalar[]>;

/** A principal whose facts are a plain record; absent keys read as undefined. */
class TestPrincipal implements IPrincipalFacts
{
    public readonly Id = 'p';

    public constructor(private readonly facts: FactMap)
    {
    }

    public Get(name: string): Scalar | readonly Scalar[] | undefined
    {
        return this.facts[name];
    }
}

interface ICustomerRow
{
    readonly Id: string;
    readonly Props: Record<string, CellValue>;
}

/** One row of the parity table: a rule set, a principal, and the rows the identity-engine evaluator lets through. */
interface IParityCase
{
    readonly Name: string;
    readonly Rules: string;
    readonly Facts: FactMap;
    /** Expected visible customers, written from the evaluator's JS semantics (undefined/null === never equal a value). */
    readonly Visible: readonly string[];
}

class PolicyFx
{
    public static readonly Customer = 'shop.Customer';
    public static readonly Vip = 'shop.VipCustomer';
    public static readonly Order = 'shop.Order';
    public static readonly Model = `namespace shop
{
    concept Customer { region : string; level : integer; score : number; vip : boolean; classification : string; }
    concept VipCustomer : Customer { }
    concept Order { name : string; owner : Customer?; }
    POLICIES
}`;

    /** c1 eu/1/1.5/vip/restricted, c2 us/2/2.5/open, c3 nothing set, c4 eu/3. */
    public static readonly Customers: readonly ICustomerRow[] = [
        { Id: 'c1', Props: { region: 'eu', level: 1n, score: 1.5, vip: true, classification: 'restricted' } },
        { Id: 'c2', Props: { region: 'us', level: 2n, score: 2.5, vip: false, classification: 'open' } },
        { Id: 'c3', Props: {} },
        { Id: 'c4', Props: { region: 'eu', level: 3n } },
    ];

    public static Compiler(policies: string): PolicyScopeCompiler
    {
        const source = PolicyFx.Model.replace('POLICIES', policies);
        const { model, diagnostics } = check([{ uri: 'shop.todl', text: source }]);
        assert.equal(diagnostics.filter((d) => d.severity === 'error' || d.code.startsWith('policy.')).length, 0, JSON.stringify(diagnostics));
        return PolicyScopeCompiler.FromRepository(model);
    }

    public static Prop(name: string, type: ValueType): MemberInput
    {
        return { Name: name, Kind: MemberKind.Property, Type: type, Nullable: true };
    }

    public static Description(): ISchemaDescription
    {
        return {
            Version: 'v1',
            Definitions: [
                {
                    Name: PolicyFx.Customer, IsAspect: false, Parent: null, Aspects: [], Members: [
                        PolicyFx.Prop('region', ValueType.String),
                        PolicyFx.Prop('level', ValueType.Int64),
                        PolicyFx.Prop('score', ValueType.Float64),
                        PolicyFx.Prop('vip', ValueType.Boolean),
                        PolicyFx.Prop('classification', ValueType.String),
                    ],
                },
                { Name: PolicyFx.Vip, IsAspect: false, Parent: PolicyFx.Customer, Aspects: [], Members: [] },
                {
                    Name: PolicyFx.Order, IsAspect: false, Parent: null, Aspects: [], Members: [
                        PolicyFx.Prop('name', ValueType.String),
                        { Name: 'owner', Kind: MemberKind.Relationship, Targets: [PolicyFx.Customer], Many: false, Ordered: false },
                    ],
                },
            ],
            Indexes: [],
            Seed: [],
            Bindings: [],
        };
    }

    public static async Open(): Promise<GraphEngine>
    {
        const engine = await GraphEngine.Open({ Description: PolicyFx.Description(), Storage: { Kind: StorageKind.Memory } });
        const t = await engine.Begin(AccessScope.System);
        for (const row of PolicyFx.Customers)
        {
            t.CreateNode(row.Id, PolicyFx.Customer);
            for (const [name, value] of Object.entries(row.Props)) t.SetProperty(row.Id, name, value);
        }
        t.CreateNode('v1', PolicyFx.Vip);
        t.SetProperty('v1', 'region', 'eu');
        t.CreateNode('v2', PolicyFx.Vip);
        t.SetProperty('v2', 'region', 'us');
        t.CreateNode('o1', PolicyFx.Order);
        t.CreateNode('o2', PolicyFx.Order);
        t.CreateNode('o3', PolicyFx.Order);
        t.Link('o1', 'owner', 'c1');
        t.Link('o2', 'owner', 'c2');
        await t.Commit();
        return engine;
    }

    public static async Scan(engine: GraphEngine, scope: AccessScope, concept: string): Promise<string[]>
    {
        const reader = await engine.BeginRead(scope);
        try
        {
            const ids: string[] = [];
            for await (const id of reader.ScanNodes(concept)) ids.push(id);
            return ids.sort();
        }
        finally
        {
            reader.dispose();
        }
    }

    /** The visible nodes of `concept`; for Customer the VipCustomer subtypes (ids `v*`) are left out unless `withSubtypes`. */
    public static async Visible(policies: string, facts: FactMap, concept = PolicyFx.Customer, access = AccessDefault.Allow, withSubtypes = false): Promise<string[]>
    {
        const engine = await PolicyFx.Open();
        try
        {
            const ids = await PolicyFx.Scan(engine, PolicyFx.Compiler(policies).Compile(new TestPrincipal(facts), access), concept);
            return withSubtypes ? ids : ids.filter((id) => !id.startsWith('v') || concept === PolicyFx.Vip);
        }
        finally
        {
            await engine.dispose();
        }
    }

    /** Runs one write against a scope; the error (an AccessError when denied) or undefined on success. */
    public static async Write(scope: AccessScope, build: (t: Awaited<ReturnType<GraphEngine['Begin']>>) => void): Promise<unknown>
    {
        const engine = await PolicyFx.Open();
        try
        {
            const t = await engine.Begin(scope);
            build(t);
            await t.Commit();
            return undefined;
        }
        catch (error)
        {
            return error;
        }
        finally
        {
            await engine.dispose();
        }
    }

    public static Policy(rules: string): string
    {
        return `policy Customer { ${rules} }`;
    }
}

describe('PolicyScopeCompiler parity with the identity-engine evaluator (P4-b..P4-d)', () =>
{
    const cases: readonly IParityCase[] = [
        { Name: 'principal fact == entity member', Rules: 'allow read when principal.region == entity.region;', Facts: { region: 'eu' }, Visible: ['c1', 'c4'] },
        { Name: 'missing fact == entity member matches unset members (undefined === undefined)', Rules: 'allow read when principal.region == entity.region;', Facts: {}, Visible: ['c3'] },
        { Name: 'fact != entity member counts unset members', Rules: 'allow read when principal.region != entity.region;', Facts: { region: 'eu' }, Visible: ['c2', 'c3'] },
        { Name: 'missing fact != entity member matches every set member', Rules: 'allow read when principal.region != entity.region;', Facts: {}, Visible: ['c1', 'c2', 'c4'] },
        { Name: 'deny == literal leaves unset members visible (no Unknown)', Rules: 'deny read when entity.classification == "restricted";', Facts: {}, Visible: ['c2', 'c3', 'c4'] },
        { Name: 'allow != literal includes unset members', Rules: 'allow read when entity.classification != "restricted";', Facts: {}, Visible: ['c2', 'c3', 'c4'] },
        { Name: 'not over == treats unset as not equal', Rules: 'allow read when not entity.region == "eu";', Facts: {}, Visible: ['c2', 'c3'] },
        { Name: 'integer field takes a whole-number fact as bigint', Rules: 'allow read when entity.level == principal.level;', Facts: { level: 2 }, Visible: ['c2'] },
        { Name: 'integer field never equals a fractional fact', Rules: 'allow read when entity.level == principal.level;', Facts: { level: 2.5 }, Visible: [] },
        { Name: 'integer field never equals a string fact; != always holds', Rules: 'allow read when entity.level != principal.level;', Facts: { level: '2' }, Visible: ['c1', 'c2', 'c3', 'c4'] },
        { Name: 'number field compares as Float64', Rules: 'allow read when entity.score == principal.score;', Facts: { score: 1.5 }, Visible: ['c1'] },
        { Name: 'boolean literal', Rules: 'allow read when entity.vip == true;', Facts: {}, Visible: ['c1'] },
        { Name: 'entity member in principal list', Rules: 'allow read when entity.region in principal.regions;', Facts: { regions: ['eu', 'zz'] }, Visible: ['c1', 'c4'] },
        { Name: 'missing list fact: membership is False', Rules: 'allow read when entity.region in principal.regions;', Facts: {}, Visible: [] },
        { Name: 'non-array fact: membership is False', Rules: 'allow read when entity.region in principal.regions;', Facts: { regions: 'eu' }, Visible: [] },
        { Name: 'principal fact in entity property', Rules: 'allow read when principal.region in entity.region;', Facts: { region: 'us' }, Visible: ['c2'] },
        { Name: 'entity.storageId == fact', Rules: 'allow read when entity.storageId == principal.me;', Facts: { me: 'c2' }, Visible: ['c2'] },
        { Name: 'entity.storageId != fact', Rules: 'allow read when entity.storageId != principal.me;', Facts: { me: 'c2' }, Visible: ['c1', 'c3', 'c4'] },
        { Name: 'entity.storageId in principal list', Rules: 'allow read when entity.storageId in principal.ids;', Facts: { ids: ['c1', 'c3'] }, Visible: ['c1', 'c3'] },
        { Name: 'entity.storageId with a missing fact: == is False', Rules: 'allow read when entity.storageId == principal.me;', Facts: {}, Visible: [] },
        { Name: 'principal-only rule folds true', Rules: 'allow read when principal.role == "admin";', Facts: { role: 'admin' }, Visible: ['c1', 'c2', 'c3', 'c4'] },
        { Name: 'principal-only rule folds false', Rules: 'allow read when principal.role == "admin";', Facts: { role: 'user' }, Visible: [] },
        { Name: 'principal-only term inside or', Rules: 'allow read when principal.role == "admin" or entity.region == "us";', Facts: { role: 'user' }, Visible: ['c2'] },
        { Name: 'two missing facts are equal (undefined === undefined)', Rules: 'allow read when principal.a == principal.b;', Facts: {}, Visible: ['c1', 'c2', 'c3', 'c4'] },
        { Name: 'array fact == literal is False', Rules: 'allow read when principal.groups == "a";', Facts: { groups: ['a'] }, Visible: [] },
        { Name: 'array fact != literal is True', Rules: 'allow read when principal.groups != "a";', Facts: { groups: ['a'] }, Visible: ['c1', 'c2', 'c3', 'c4'] },
        { Name: 'allow and deny combine', Rules: 'allow read when entity.region == "eu"; deny read when entity.level == 3;', Facts: {}, Visible: ['c1'] },
        { Name: 'deny only: everything except the denied', Rules: 'deny read when entity.region == "eu";', Facts: {}, Visible: ['c2', 'c3'] },
        { Name: 'a deny whose term folds False un-denies', Rules: 'allow read when entity.region == "eu"; deny read when principal.role == "blocked";', Facts: { role: 'user' }, Visible: ['c1', 'c4'] },
        { Name: 'a deny whose term folds True denies all', Rules: 'allow read when entity.region == "eu"; deny read when principal.role == "blocked";', Facts: { role: 'blocked' }, Visible: [] },
        { Name: 'an allow with only False terms allows nobody', Rules: 'allow read when principal.role == "admin";', Facts: {}, Visible: [] },
        { Name: 'no read rule: reads are allowed', Rules: 'allow write when entity.region == "eu";', Facts: {}, Visible: ['c1', 'c2', 'c3', 'c4'] },
    ];

    for (const c of cases)
    {
        test(c.Name, async () =>
        {
            assert.deepEqual(await PolicyFx.Visible(PolicyFx.Policy(c.Rules), c.Facts), [...c.Visible]);
        });
    }
});

describe('PolicyScopeCompiler scope shape', () =>
{
    test('unpolicied concept uses the default', async () =>
    {
        const policy = PolicyFx.Policy('allow read when entity.region == "eu";');
        assert.deepEqual(await PolicyFx.Visible(policy, {}, PolicyFx.Order, AccessDefault.Allow), ['o1', 'o2', 'o3']);
        assert.deepEqual(await PolicyFx.Visible(policy, {}, PolicyFx.Order, AccessDefault.Deny), []);
    });

    test('policied concept with no rule for the action allows it even under Default Deny', async () =>
    {
        const policy = PolicyFx.Policy('allow write when entity.region == "eu";');
        assert.deepEqual(await PolicyFx.Visible(policy, {}, PolicyFx.Customer, AccessDefault.Deny), ['c1', 'c2', 'c3', 'c4']);
    });

    test('rows are keyed by the concept full name and writes get the same predicate for create, update and delete', () =>
    {
        const scope = PolicyFx.Compiler(PolicyFx.Policy('allow write when entity.region == "eu";')).Compile(new TestPrincipal({}), AccessDefault.Allow);
        assert.deepEqual([...scope.Rows.keys()], [PolicyFx.Customer]);
        const writes = scope.Writes.get(PolicyFx.Customer)!;
        assert.equal(writes.Create, writes.Update);
        assert.equal(writes.Update, writes.Delete);
    });

    test('subtype inherits policy', async () =>
    {
        const policy = PolicyFx.Policy('allow read when entity.region == "us";');
        assert.deepEqual(await PolicyFx.Visible(policy, {}, PolicyFx.Vip), ['v2']);
        assert.deepEqual(await PolicyFx.Visible(policy, {}, PolicyFx.Customer, AccessDefault.Allow, true), ['c2', 'v2']);
    });

    test('entity.id is accepted as the node id like storageId', async () =>
    {
        const { model } = check([{ uri: 'shop.todl', text: PolicyFx.Model.replace('POLICIES', '') }]);
        const rules = [{ effect: 'allow', action: 'read', predicate: { kind: PolicyNodeKind.Compare, op: PolicyCompareOp.Eq, left: { kind: PolicyNodeKind.Ref, root: PolicyRefRoot.Entity, member: 'id' }, right: { kind: PolicyNodeKind.Ref, root: PolicyRefRoot.Principal, member: 'me' } } }];
        model.builder().definePolicy('shop.Customer@policy', 'shop.Customer', JSON.stringify(rules)).commit();
        const engine = await PolicyFx.Open();
        const scope = PolicyScopeCompiler.FromRepository(model).Compile(new TestPrincipal({ me: 'c3' }), AccessDefault.Allow);
        assert.deepEqual(await PolicyFx.Scan(engine, scope, PolicyFx.Vip), []);
        assert.deepEqual((await PolicyFx.Scan(engine, scope, PolicyFx.Customer)).filter((id) => id.startsWith('c')), ['c3']);
        await engine.dispose();
    });

    test('relationship membership: entity relationship in principal list', async () =>
    {
        const policies = 'policy Order { allow read when entity.owner in principal.owners; }';
        assert.deepEqual(await PolicyFx.Visible(policies, { owners: ['c1'] }, PolicyFx.Order), ['o1']);
        assert.deepEqual(await PolicyFx.Visible(policies, { owners: [] }, PolicyFx.Order), []);
    });

    test('relationship membership: principal fact in entity relationship', async () =>
    {
        const policies = 'policy Order { allow read when principal.me in entity.owner; }';
        assert.deepEqual(await PolicyFx.Visible(policies, { me: 'c2' }, PolicyFx.Order), ['o2']);
        assert.deepEqual(await PolicyFx.Visible(policies, {}, PolicyFx.Order), []);
    });
});

describe('PolicyScopeCompiler writes', () =>
{
    const policy = PolicyFx.Policy('allow write when entity.region == "eu"; deny write when entity.level == 3;');
    const scope = (): AccessScope => PolicyFx.Compiler(policy).Compile(new TestPrincipal({}), AccessDefault.Allow);

    test('update and delete obey the compiled write predicate', async () =>
    {
        assert.equal(await PolicyFx.Write(scope(), (t) => t.SetProperty('c1', 'vip', false)), undefined);
        const denied = await PolicyFx.Write(scope(), (t) => t.SetProperty('c2', 'vip', true));
        assert.ok(denied instanceof AccessError);
        assert.equal(denied.Code, AccessErrorCode.UpdateDenied);
        assert.equal(await PolicyFx.Write(scope(), (t) => t.DeleteNode('c1')), undefined);
        const noDelete = await PolicyFx.Write(scope(), (t) => t.DeleteNode('c4'));
        assert.ok(noDelete instanceof AccessError);
        assert.equal(noDelete.Code, AccessErrorCode.DeleteDenied);
    });

    test('create obeys the compiled write predicate', async () =>
    {
        assert.equal(await PolicyFx.Write(scope(), (t) => { t.CreateNode('n', PolicyFx.Customer); t.SetProperty('n', 'region', 'eu'); }), undefined);
        const denied = await PolicyFx.Write(scope(), (t) => { t.CreateNode('n', PolicyFx.Customer); t.SetProperty('n', 'region', 'us'); });
        assert.ok(denied instanceof AccessError);
        assert.equal(denied.Code, AccessErrorCode.CreateDenied);
    });

    test('related write predicate denies create', async () =>
    {
        const orders = 'policy Order { allow write when entity.owner in principal.owners; }';
        const orderScope = (): AccessScope => PolicyFx.Compiler(orders).Compile(new TestPrincipal({ owners: ['c1'] }), AccessDefault.Allow);
        const denied = await PolicyFx.Write(orderScope(), (t) => { t.CreateNode('o9', PolicyFx.Order); t.Link('o9', 'owner', 'c1'); });
        assert.ok(denied instanceof AccessError);
        assert.equal(denied.Code, AccessErrorCode.CreateDenied);
        // The restriction is create-only: an existing owned order can still be updated.
        assert.equal(await PolicyFx.Write(orderScope(), (t) => t.SetProperty('o1', 'name', 'x')), undefined);
        const foreign = await PolicyFx.Write(orderScope(), (t) => t.SetProperty('o2', 'name', 'x'));
        assert.ok(foreign instanceof AccessError);
    });
});

describe('PolicyScopeCompiler inexpressible leaves (P4-e)', () =>
{
    test('entity vs entity: False in an allow, reported', async () =>
    {
        const compiler = PolicyFx.Compiler(PolicyFx.Policy('allow read when entity.region == entity.classification;'));
        const scope = compiler.Compile(new TestPrincipal({}), AccessDefault.Allow);
        assert.deepEqual(compiler.Diagnostics.map((d) => d.Code), [PolicyDiagnosticCode.EntityToEntity]);
        assert.equal(compiler.Diagnostics[0]!.Concept, PolicyFx.Customer);
        const engine = await PolicyFx.Open();
        assert.deepEqual(await PolicyFx.Scan(engine, scope, PolicyFx.Customer), []);
        await engine.dispose();
    });

    test('entity vs entity: True in a deny, so everything is denied', async () =>
    {
        const policies = PolicyFx.Policy('deny read when entity.region == entity.classification;');
        assert.deepEqual(await PolicyFx.Visible(policies, {}), []);
    });

    test('the failure value flips under not, so an allow still fails closed', async () =>
    {
        const policies = PolicyFx.Policy('allow read when not entity.region == entity.classification;');
        assert.deepEqual(await PolicyFx.Visible(policies, {}), []);
    });

    test('comparison on a relationship member is reported and fails closed', async () =>
    {
        const compiler = PolicyFx.Compiler('policy Order { allow read when entity.owner == principal.me; }');
        compiler.Compile(new TestPrincipal({ me: 'c1' }), AccessDefault.Allow);
        assert.deepEqual(compiler.Diagnostics.map((d) => d.Code), [PolicyDiagnosticCode.RelationshipCompare]);
        assert.deepEqual(await PolicyFx.Visible('policy Order { allow read when entity.owner == principal.me; }', { me: 'c1' }, PolicyFx.Order), []);
    });

    test('Diagnostics reset on each Compile', () =>
    {
        const compiler = PolicyFx.Compiler(PolicyFx.Policy('allow read when entity.region == entity.classification;'));
        compiler.Compile(new TestPrincipal({}), AccessDefault.Allow);
        compiler.Compile(new TestPrincipal({}), AccessDefault.Allow);
        assert.equal(compiler.Diagnostics.length, 1);
    });
});
