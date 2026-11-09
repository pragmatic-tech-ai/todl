import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    AccessDefault,
    AccessError,
    AccessErrorCode,
    AccessScope,
    BindingTable,
    FalsePredicate,
    GraphEngine,
    MemberKind,
    StorageKind,
    ValueType,
    type CellValue,
    type ISchemaDescription,
    type MemberInput,
} from '@pragmatic-tech-ai/graph';
import type { Repository } from '../../compiler-services/model/model.js';
import { check } from '../../compiler-services/api.js';
import { PolicyCompareOp, PolicyNodeKind, PolicyRefRoot } from '../../compiler-services/policy/policy-predicate.js';
import type { Scalar } from '../../manifest/logical.js';
import { compilePackage } from '../../publish/publish.js';
import { PackageManifestBridge } from '../../solution-services/package-manager/package-manifest-bridge.js';
import { Domain } from '../../domain/domain.js';
import { MemoryPackageSource } from '../../domain/memory-package-source.js';
import { SnapshotDescriber } from '../SnapshotDescriber.js';
import { PolicyDiagnosticCode, PolicyScopeCompiler } from '../PolicyScopeCompiler.js';
import { MessageFormat } from '../MessageFormat.js';
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
        { Name: 'integer field takes a decimal-string fact as bigint; != keeps unset members', Rules: 'allow read when entity.level != principal.level;', Facts: { level: '2' }, Visible: ['c1', 'c3', 'c4'] },
        { Name: 'integer field never equals a fractional fact', Rules: 'allow read when entity.level == principal.level;', Facts: { level: 2.5 }, Visible: [] },
        { Name: 'number field compares a decimal-string fact as Float64', Rules: 'allow read when entity.score == principal.score;', Facts: { score: '1.5' }, Visible: ['c1'] },
        { Name: 'boolean literal', Rules: 'allow read when entity.vip == true;', Facts: {}, Visible: ['c1'] },
        { Name: 'entity member in principal list', Rules: 'allow read when entity.region in principal.regions;', Facts: { regions: ['eu', 'zz'] }, Visible: ['c1', 'c4'] },
        { Name: 'missing list fact: membership is False', Rules: 'allow read when entity.region in principal.regions;', Facts: {}, Visible: [] },
        { Name: 'non-array fact: membership is False', Rules: 'allow read when entity.region in principal.regions;', Facts: { regions: 'eu' }, Visible: [] },
        { Name: 'principal fact in entity property never matches (P4-i: entity members are scalars)', Rules: 'allow read when principal.region in entity.region;', Facts: { region: 'us' }, Visible: [] },
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
        { Name: 'allow and deny combine', Rules: 'allow read when entity.region == "eu"; deny read when entity.level == "3";', Facts: {}, Visible: ['c1'] },
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

/**
 * Rulings PF-a / PF-f: TODL holds numeric entity values as decimal text and the evaluator compares raw values with ===,
 * so a canonical decimal-string fact or literal matches the member's number, a JS number never equals it, and a
 * non-canonical string (whose text no canonical entity value can equal) fails closed.
 */
class NumericParityFx
{
    public static readonly All: readonly string[] = ['c1', 'c2', 'c3', 'c4'];
    public static readonly AllButC2: readonly string[] = ['c1', 'c3', 'c4'];
    public static readonly OnlyC2: readonly string[] = ['c2'];
    public static readonly Nobody: readonly string[] = [];
    public static readonly AllowEq = 'allow read when entity.{0} == {1};';
    public static readonly DenyEq = 'deny read when entity.{0} == {1};';
    public static readonly FactOperand = 'principal.v';
    public static readonly FactName = 'v';
    public static readonly Level = 'level';
    public static readonly Score = 'score';
    public static readonly LevelText = '2';
    public static readonly LevelValue = 2;
    public static readonly ScoreText = '2.5';
    public static readonly ScoreValue = 2.5;
    /** Texts of level 2 / score 2.5 that are not their canonical form. */
    public static readonly NonCanonicalLevels: readonly string[] = ['02', '+2', '2.0', '0x2', '2e0', ' 2'];
    public static readonly NonCanonicalScores: readonly string[] = ['2.50', '+2.5', '02.5', '25e-1', ' 2.5'];
    public static readonly AllowStringFact = '{0}: allow == string fact';
    public static readonly AllowNumberFact = '{0}: allow == number fact never matches';
    public static readonly AllowStringLiteral = '{0}: allow == string literal';
    public static readonly AllowNumberLiteral = '{0}: allow == number literal never matches';
    public static readonly DenyStringFact = '{0}: deny == string fact';
    public static readonly DenyNumberFact = '{0}: deny == number fact never denies';
    public static readonly DenyStringLiteral = '{0}: deny == string literal';
    public static readonly DenyNumberLiteral = '{0}: deny == number literal never denies';
    public static readonly AllowNonCanonical = '{0}: allow == non-canonical fact "{1}" fails closed';
    public static readonly DenyNonCanonical = '{0}: deny == non-canonical fact "{1}" fails closed (denies everyone)';

    /** One field (level 2 / score 2.5 on c2), every operand form, allow and deny. */
    public static Cases(member: string, text: string, value: number): IParityCase[]
    {
        const F = NumericParityFx;
        const rule = (template: string, operand: string): string => MessageFormat.Format(template, member, operand);
        const title = (template: string): string => MessageFormat.Format(template, member);
        return [
            { Name: title(F.AllowStringFact), Rules: rule(F.AllowEq, F.FactOperand), Facts: { [F.FactName]: text }, Visible: F.OnlyC2 },
            { Name: title(F.AllowNumberFact), Rules: rule(F.AllowEq, F.FactOperand), Facts: { [F.FactName]: value }, Visible: F.Nobody },
            { Name: title(F.AllowStringLiteral), Rules: rule(F.AllowEq, JSON.stringify(text)), Facts: {}, Visible: F.OnlyC2 },
            { Name: title(F.AllowNumberLiteral), Rules: rule(F.AllowEq, text), Facts: {}, Visible: F.Nobody },
            { Name: title(F.DenyStringFact), Rules: rule(F.DenyEq, F.FactOperand), Facts: { [F.FactName]: text }, Visible: F.AllButC2 },
            { Name: title(F.DenyNumberFact), Rules: rule(F.DenyEq, F.FactOperand), Facts: { [F.FactName]: value }, Visible: F.All },
            { Name: title(F.DenyStringLiteral), Rules: rule(F.DenyEq, JSON.stringify(text)), Facts: {}, Visible: F.AllButC2 },
            { Name: title(F.DenyNumberLiteral), Rules: rule(F.DenyEq, text), Facts: {}, Visible: F.All },
        ];
    }

    /** Ruling PF-f: a non-canonical claim fails closed in either position (allow: nobody; deny: everyone denied). */
    public static NonCanonical(member: string, texts: readonly string[]): IParityCase[]
    {
        const F = NumericParityFx;
        return texts.flatMap((text) => [
            { Name: MessageFormat.Format(F.AllowNonCanonical, member, text), Rules: MessageFormat.Format(F.AllowEq, member, F.FactOperand), Facts: { [F.FactName]: text }, Visible: F.Nobody },
            { Name: MessageFormat.Format(F.DenyNonCanonical, member, text), Rules: MessageFormat.Format(F.DenyEq, member, F.FactOperand), Facts: { [F.FactName]: text }, Visible: F.Nobody },
        ]);
    }

    public static AllCases(): IParityCase[]
    {
        const F = NumericParityFx;
        return [
            ...F.Cases(F.Level, F.LevelText, F.LevelValue),
            ...F.Cases(F.Score, F.ScoreText, F.ScoreValue),
            ...F.NonCanonical(F.Level, F.NonCanonicalLevels),
            ...F.NonCanonical(F.Score, F.NonCanonicalScores),
        ];
    }
}

describe('PolicyScopeCompiler numeric members mirror the evaluator (PF-a, PF-f)', () =>
{
    for (const c of NumericParityFx.AllCases())
    {
        test(c.Name, async () =>
        {
            assert.deepEqual(await PolicyFx.Visible(PolicyFx.Policy(c.Rules), c.Facts), [...c.Visible]);
        });
    }

    test('a number literal on a numeric member is reported as never matching', () =>
    {
        const compiler = PolicyFx.Compiler(PolicyFx.Policy('allow read when entity.level == 2; deny read when entity.score != 2.5;'));
        assert.deepEqual(compiler.Diagnostics.map((d) => [d.Code, d.Concept]), [
            [PolicyDiagnosticCode.NeverMatches, PolicyFx.Customer],
            [PolicyDiagnosticCode.NeverMatches, PolicyFx.Customer],
        ]);
    });

    test('an unconvertible string fails closed with a diagnostic: allow admits nobody, deny denies everyone', async () =>
    {
        assert.deepEqual(await PolicyFx.Visible(PolicyFx.Policy('allow read when entity.level == "2.5";'), {}), []);
        assert.deepEqual(await PolicyFx.Visible(PolicyFx.Policy('deny read when entity.level == principal.v;'), { v: 'two' }), []);
        assert.deepEqual(await PolicyFx.Visible(PolicyFx.Policy('allow read when entity.score != principal.v;'), { v: 'x' }), []);
        const compiler = PolicyFx.Compiler(PolicyFx.Policy('allow read when entity.level == "2.5";'));
        assert.deepEqual(compiler.Diagnostics.map((d) => d.Code), [PolicyDiagnosticCode.ValueTypeMismatch]);
    });

    test('membership takes decimal-string elements and never matches number elements', async () =>
    {
        assert.deepEqual(await PolicyFx.Visible(PolicyFx.Policy('allow read when entity.level in principal.v;'), { v: ['1', 3] }), ['c1']);
        assert.deepEqual(await PolicyFx.Visible(PolicyFx.Policy('allow read when entity.score in principal.v;'), { v: [1.5, '2.5'] }), ['c2']);
        assert.deepEqual(await PolicyFx.Visible(PolicyFx.Policy('allow read when entity.level in principal.v;'), { v: [1, 2] }), []);
    });
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
        try
        {
            const scope = PolicyScopeCompiler.FromRepository(model).Compile(new TestPrincipal({ me: 'c3' }), AccessDefault.Allow);
            assert.deepEqual(await PolicyFx.Scan(engine, scope, PolicyFx.Vip), []);
            assert.deepEqual((await PolicyFx.Scan(engine, scope, PolicyFx.Customer)).filter((id) => id.startsWith('c')), ['c3']);
        }
        finally
        {
            await engine.dispose();
        }
    });

    test('relationship membership: entity relationship in principal list', async () =>
    {
        const policies = 'policy Order { allow read when entity.owner in principal.owners; }';
        assert.deepEqual(await PolicyFx.Visible(policies, { owners: ['c1'] }, PolicyFx.Order), ['o1']);
        assert.deepEqual(await PolicyFx.Visible(policies, { owners: [] }, PolicyFx.Order), []);
    });

    test('principal fact in entity relationship never matches and is reported (P4-i)', async () =>
    {
        const policies = 'policy Order { allow read when principal.me in entity.owner; }';
        assert.deepEqual(await PolicyFx.Visible(policies, { me: 'c2' }, PolicyFx.Order), []);
        assert.deepEqual(PolicyFx.Compiler(policies).Diagnostics.map((d) => d.Code), [PolicyDiagnosticCode.NeverMatches]);
    });
});

describe('PolicyScopeCompiler relationship membership over hidden targets (P4-h)', () =>
{
    // c2 (region us) is invisible to the reader: Customer is allowed by region "eu" only.
    const eu = PolicyFx.Policy('allow read when entity.region == "eu";');

    test('deny: a hidden blocked owner still denies', async () =>
    {
        const policies = `${eu} policy Order { deny read when entity.owner in principal.blocked; }`;
        assert.deepEqual(await PolicyFx.Visible(policies, { blocked: ['c2'] }, PolicyFx.Order), ['o1', 'o3']);
    });

    test('deny: still denies when the target concept falls to Default Deny', async () =>
    {
        const policies = 'policy Order { deny read when entity.owner in principal.blocked; }';
        assert.deepEqual(await PolicyFx.Visible(policies, { blocked: ['c2'] }, PolicyFx.Order, AccessDefault.Deny), ['o1', 'o3']);
    });

    test('allow: a hidden owner does not grant (narrower than the evaluator, never wider)', async () =>
    {
        const policies = `${eu} policy Order { allow read when entity.owner in principal.owners; }`;
        assert.deepEqual(await PolicyFx.Visible(policies, { owners: ['c2'] }, PolicyFx.Order), []);
        assert.deepEqual(await PolicyFx.Visible(policies, { owners: ['c1'] }, PolicyFx.Order), ['o1']);
    });

    test('not in an allow flips the position: a hidden blocked owner is still excluded', async () =>
    {
        const policies = `${eu} policy Order { allow read when not entity.owner in principal.blocked; }`;
        assert.deepEqual(await PolicyFx.Visible(policies, { blocked: ['c2'] }, PolicyFx.Order), ['o1', 'o3']);
    });

    test('deny write: update and delete of an order owned by a hidden blocked customer are denied', async () =>
    {
        const policies = `${eu} policy Order { deny write when entity.owner in principal.blocked; }`;
        const scope = (): AccessScope => PolicyFx.Compiler(policies).Compile(new TestPrincipal({ blocked: ['c2'] }), AccessDefault.Allow);
        const update = await PolicyFx.Write(scope(), (t) => t.SetProperty('o2', 'name', 'x'));
        assert.ok(update instanceof AccessError);
        assert.equal(update.Code, AccessErrorCode.UpdateDenied);
        const del = await PolicyFx.Write(scope(), (t) => t.DeleteNode('o2'));
        assert.ok(del instanceof AccessError);
        assert.equal(del.Code, AccessErrorCode.DeleteDenied);
        assert.equal(await PolicyFx.Write(scope(), (t) => t.SetProperty('o1', 'name', 'x')), undefined);
    });

    test('allow write: a hidden owner does not grant update', async () =>
    {
        const policies = `${eu} policy Order { allow write when entity.owner in principal.owners; }`;
        const scope = PolicyFx.Compiler(policies).Compile(new TestPrincipal({ owners: ['c2'] }), AccessDefault.Allow);
        const update = await PolicyFx.Write(scope, (t) => t.SetProperty('o2', 'name', 'x'));
        assert.ok(update instanceof AccessError);
        assert.equal(update.Code, AccessErrorCode.UpdateDenied);
    });
});

describe('PolicyScopeCompiler writes', () =>
{
    const policy = PolicyFx.Policy('allow write when entity.region == "eu"; deny write when entity.level == "3";');
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
        assert.equal(foreign.Code, AccessErrorCode.UpdateDenied);
    });

    test('a folded-away related term leaves creates decidable', async () =>
    {
        const orders = 'policy Order { deny write when entity.owner in principal.blocked; }';
        const orderScope = (blocked: string[]): AccessScope => PolicyFx.Compiler(orders).Compile(new TestPrincipal({ blocked }), AccessDefault.Allow);
        assert.equal(await PolicyFx.Write(orderScope([]), (t) => { t.CreateNode('o9', PolicyFx.Order); t.Link('o9', 'owner', 'c1'); }), undefined);
        const denied = await PolicyFx.Write(orderScope(['c2']), (t) => { t.CreateNode('o9', PolicyFx.Order); t.Link('o9', 'owner', 'c1'); });
        assert.ok(denied instanceof AccessError);
        assert.equal(denied.Code, AccessErrorCode.CreateDenied);
    });

    test('an admin-style principal term folds the related term away', async () =>
    {
        const orders = 'policy Order { allow write when principal.role == "admin" or entity.owner in principal.owners; }';
        const scope = PolicyFx.Compiler(orders).Compile(new TestPrincipal({ role: 'admin', owners: ['c1'] }), AccessDefault.Allow);
        assert.equal(await PolicyFx.Write(scope, (t) => { t.CreateNode('o9', PolicyFx.Order); t.Link('o9', 'owner', 'c1'); }), undefined);
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
        try
        {
            assert.deepEqual(await PolicyFx.Scan(engine, scope, PolicyFx.Customer), []);
        }
        finally
        {
            await engine.dispose();
        }
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

    test('relationship compare inside a deny is True: every order is denied', async () =>
    {
        const policies = 'policy Order { deny read when entity.owner == principal.me; }';
        assert.deepEqual(await PolicyFx.Visible(policies, { me: 'c1' }, PolicyFx.Order), []);
        assert.deepEqual(PolicyFx.Compiler(policies).Diagnostics.map((d) => d.Code), [PolicyDiagnosticCode.RelationshipCompare]);
    });

    test('Diagnostics are structural: known before Compile, stable across principals, and a copy', () =>
    {
        const compiler = PolicyFx.Compiler(PolicyFx.Policy('allow read when entity.region == entity.classification;'));
        const before = compiler.Diagnostics;
        assert.equal(before.length, 1);
        compiler.Compile(new TestPrincipal({}), AccessDefault.Allow);
        compiler.Compile(new TestPrincipal({ region: 'eu' }), AccessDefault.Allow);
        assert.equal(compiler.Diagnostics.length, 1);
        assert.notEqual(compiler.Diagnostics, before);
    });
});

class Malformed
{
    public static async Run(rulesJson: string): Promise<{ readonly Compiler: PolicyScopeCompiler; readonly Visible: string[]; readonly Write: unknown }>
    {
        const { model } = check([{ uri: 'shop.todl', text: PolicyFx.Model.replace('POLICIES', '') }]);
        model.builder().definePolicy('shop.Customer@policy', 'shop.Customer', rulesJson).commit();
        const compiler = PolicyScopeCompiler.FromRepository(model);
        const scope = compiler.Compile(new TestPrincipal({}), AccessDefault.Allow);
        const engine = await PolicyFx.Open();
        try
        {
            return { Compiler: compiler, Visible: await PolicyFx.Scan(engine, scope, PolicyFx.Vip), Write: await PolicyFx.Write(scope, (t) => t.SetProperty('c1', 'vip', false)) };
        }
        finally
        {
            await engine.dispose();
        }
    }
}

describe('PolicyScopeCompiler malformed policy nodes (P4-j)', () =>
{
    const bad: ReadonlyArray<readonly [string, string]> = [
        ['invalid JSON', 'not json'],
        ['not an array', '{}'],
        ['unknown effect', '[{"effect":"maybe","action":"read","predicate":{"kind":0}}]'],
        ['unknown action', '[{"effect":"allow","action":"peek","predicate":{"kind":0}}]'],
    ];
    for (const [name, json] of bad)
    {
        test(`${name}: reported, reads and writes denied, never throws`, async () =>
        {
            const result = await Malformed.Run(json);
            assert.deepEqual(result.Compiler.Diagnostics.map((d) => d.Code), [PolicyDiagnosticCode.MalformedPolicy]);
            assert.deepEqual(result.Visible, []);
            assert.ok(result.Write instanceof AccessError);
        });
    }
});

describe('PolicyScopeCompiler member mapping matches SnapshotDescriber', () =>
{
    test('every member of the fixture concept has the describer kind and value type', async () =>
    {
        const source = `namespace shop
{
    primitive sku : string { }
    primitive qty : integer { }
    concept Loc { }
    concept Widget
    {
        name : string?; count : integer?; weight : number?; ok : boolean?;
        code : sku?; amount : qty?; kind : Kinds?; kinds : Kinds[]; home : Loc?;
        relationship parts -> Widget[];
    }
    taxonomy Kinds : represents Widget { term Big { } term Small { } }
    policy Widget { allow read when entity.name == "x"; }
}`;
        const { model } = check([{ uri: 'shop.todl', text: source }]);
        const compiler = PolicyScopeCompiler.FromRepository(model);
        const out = compilePackage([], [{ uri: 'shop.p.todl', text: source }], { id: 'shop.p', version: '1.0.0' });
        assert.ok(out.ok, JSON.stringify(out.errors));
        const store = new MemoryPackageSource();
        store.Add(PackageManifestBridge.toResolved(out.package!));
        const domain = new Domain(store);
        await domain.load({ model: 'shop.p', version: '1.0.0' });
        const description = SnapshotDescriber.Describe(domain.graph, { DefaultConnector: BindingTable.EngineStorage }).Description;
        const members: MemberInput[] = [];
        for (let name: string | null = 'shop.Widget'; name !== null;)
        {
            const definition = description.Definitions.find((d) => d.Name === name);
            assert.ok(definition, `definition ${name}`);
            members.push(...definition.Members);
            name = definition.Parent;
        }
        const mine = compiler.MembersOf('shop.Widget');
        assert.ok(mine.size >= 10);
        for (const [name, member] of mine)
        {
            const theirs: MemberInput | undefined = members.find((m) => m.Name === name);
            assert.ok(theirs, `describer has ${name}`);
            assert.equal(member.IsRelationship, theirs.Kind === MemberKind.Relationship, name);
            if (!member.IsRelationship)
            {
                assert.equal(member.Type, theirs.Type, name);
            }
        }
    });
});

class Described
{
    /** The fixture description with Customer.region and the Order concept removed (as a lossy describer could). */
    public static Lossy(): ISchemaDescription
    {
        const full = PolicyFx.Description();
        return {
            ...full,
            Definitions: full.Definitions
                .filter((d) => d.Name !== PolicyFx.Order)
                .map((d) => d.Name === PolicyFx.Customer ? { ...d, Members: d.Members.filter((m) => m.Name !== 'region') } : d),
        };
    }

    public static async Run(description: ISchemaDescription, scopeOf: (d: ISchemaDescription) => AccessScope): Promise<string[]>
    {
        const engine = await GraphEngine.Open({ Description: description, Storage: { Kind: StorageKind.Memory } });
        try
        {
            const seed = await engine.Begin(AccessScope.System);
            seed.CreateNode('c1', PolicyFx.Customer);
            seed.SetProperty('c1', 'level', 1n);
            await seed.Commit();
            const scope = scopeOf(description);
            const txn = await engine.Begin(scope);
            txn.SetProperty('c1', 'level', 2n);
            try
            {
                await txn.Commit();
            }
            catch (error)
            {
                assert.ok(error instanceof AccessError, 'a denied write, not a scope rejection');
            }
            return await PolicyFx.Scan(engine, scope, PolicyFx.Customer);
        }
        finally
        {
            await engine.dispose();
        }
    }
}

describe('PolicyScopeCompiler against the engine schema (P4-l)', () =>
{
    const policies = `${PolicyFx.Policy('allow read when entity.region == "eu"; allow write when entity.level == "1";')} policy Order { allow read when entity.name == "x"; }`;
    const source = PolicyFx.Model.replace('POLICIES', policies);

    test('without the schema, a policy over a missing member makes the engine reject the scope', async () =>
    {
        const { model } = check([{ uri: 'shop.todl', text: source }]);
        await assert.rejects(Described.Run(Described.Lossy(), () => PolicyScopeCompiler.FromRepository(model).Compile(new TestPrincipal({}), AccessDefault.Allow)));
    });

    test('with the schema, a missing member fails closed and a missing concept is omitted: no rejection', async () =>
    {
        const { model } = check([{ uri: 'shop.todl', text: source }]);
        let compiler: PolicyScopeCompiler | undefined;
        const visible = await Described.Run(Described.Lossy(), (d) =>
        {
            compiler = PolicyScopeCompiler.FromRepository(model, d);
            return compiler.Compile(new TestPrincipal({}), AccessDefault.Allow);
        });
        assert.deepEqual(visible, []);
        const codes = compiler!.Diagnostics.map((d) => d.Code).sort();
        assert.deepEqual(codes, [PolicyDiagnosticCode.UnknownMember, PolicyDiagnosticCode.UnknownConcept].sort());
    });

    test('a policied concept the schema lacks falls to the scope Default', () =>
    {
        const { model } = check([{ uri: 'shop.todl', text: source }]);
        const scope = PolicyScopeCompiler.FromRepository(model, Described.Lossy()).Compile(new TestPrincipal({}), AccessDefault.Allow);
        assert.deepEqual([...scope.Rows.keys()], [PolicyFx.Customer]);
    });

    test('a member the schema has as the other kind fails closed', async () =>
    {
        const full = PolicyFx.Description();
        const flipped: ISchemaDescription = {
            ...full,
            Definitions: full.Definitions.map((d) => d.Name === PolicyFx.Customer
                ? { ...d, Members: d.Members.map((m) => m.Name === 'region' ? ({ Name: 'region', Kind: MemberKind.Relationship, Targets: [PolicyFx.Customer], Many: false, Ordered: false } as MemberInput) : m) }
                : d),
        };
        const { model } = check([{ uri: 'shop.todl', text: source }]);
        const compiler = PolicyScopeCompiler.FromRepository(model, flipped);
        assert.ok(compiler.Diagnostics.some((d) => d.Code === PolicyDiagnosticCode.RelationshipCompare));
        const engine = await GraphEngine.Open({ Description: flipped, Storage: { Kind: StorageKind.Memory } });
        try
        {
            assert.deepEqual(await PolicyFx.Scan(engine, compiler.Compile(new TestPrincipal({}), AccessDefault.Allow), PolicyFx.Customer), []);
        }
        finally
        {
            await engine.dispose();
        }
    });

    test('a policy node without a concept attribute is malformed and fails closed under the id-derived name', () =>
    {
        class StubNode
        {
            public readonly attrs = new Map<string, string>([['rules', '[]']]);
        }
        const stub = {
            nodesOfMetaKind: () => ['shop.Customer@policy'],
            resolve: (id: string) => id.endsWith('@policy') ? new StubNode() : undefined,
        } as unknown as Repository;
        const compiler = PolicyScopeCompiler.FromRepository(stub);
        assert.deepEqual(compiler.Diagnostics.map((d) => d.Code), [PolicyDiagnosticCode.MalformedPolicy]);
        assert.equal(compiler.Diagnostics[0]!.Concept, PolicyFx.Customer);
        const scope = compiler.Compile(new TestPrincipal({}), AccessDefault.Allow);
        assert.equal(scope.Rows.get(PolicyFx.Customer), FalsePredicate.Instance);
    });
});

describe('PolicyScopeCompiler compiled scope passes engine validation on the aspects fixture', () =>
{
    test('Begin and scan succeed for arbitrary principals', async () =>
    {
        const source = `namespace shop
{
    concept Loc { }
    aspect Placed { relationship at -> Loc?; tag : string?; }
    concept Widget : Placed
    {
        name : string?; count : integer?; weight : number?; ok : boolean?;
        kind : Kinds?; kinds : Kinds[]; home : Loc?;
        relationship parts -> Widget[];
    }
    taxonomy Kinds : represents Widget { term Big { } term Small { } }
    policy Widget
    {
        allow read when entity.tag == "t" or entity.name in principal.names or entity.home in principal.homes;
        deny read when entity.home in principal.blocked or entity.kinds in principal.blocked or entity.count != principal.count;
        allow write when entity.ok == true or entity.home in principal.homes;
        deny write when entity.weight == principal.weight and entity.kind == "Big";
    }
}`;
        const { model } = check([{ uri: 'shop.todl', text: source }]);
        const out = compilePackage([], [{ uri: 'shop.p.todl', text: source }], { id: 'shop.p', version: '1.0.0' });
        assert.ok(out.ok, JSON.stringify(out.errors));
        const store = new MemoryPackageSource();
        store.Add(PackageManifestBridge.toResolved(out.package!));
        const domain = new Domain(store);
        await domain.load({ model: 'shop.p', version: '1.0.0' });
        const description = SnapshotDescriber.Describe(domain.graph, { DefaultConnector: BindingTable.EngineStorage }).Description;
        const compiler = PolicyScopeCompiler.FromRepository(model, description);
        const engine = await GraphEngine.Open({ Description: description, Storage: { Kind: StorageKind.Memory } });
        try
        {
            const principals: FactMap[] = [{}, { names: ['a'], homes: ['l1'], blocked: ['l1'], count: 3, weight: 1.5 }, { names: [], homes: [], blocked: [] }];
            for (const facts of principals)
            {
                const scope = compiler.Compile(new TestPrincipal(facts), AccessDefault.Allow);
                const reader = await engine.BeginRead(scope);
                const ids: string[] = [];
                for await (const id of reader.ScanNodes('shop.Widget')) ids.push(id);
                reader.dispose();
                const txn = await engine.Begin(scope);
                txn.CreateNode('w', 'shop.Widget');
                await txn.Commit().catch((error: unknown) => assert.ok(error instanceof AccessError));
            }
        }
        finally
        {
            await engine.dispose();
        }
    });
});
