import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    And,
    IsNull,
    Not,
    AccessDefault,
    AccessScope,
    Compare,
    CompareOp,
    FalsePredicate,
    GraphEngine,
    MemberKind,
    PredicateCodec,
    StorageKind,
    ValueType,
    type CellValue,
    type ISchemaDescription,
    type MemberInput,
    type Predicate,
} from '@pragmatic-tech-ai/graph';
import { check } from '../../compiler-services/api.js';
import { Builder } from '../../compiler-services/model/builder.js';
import { PolicyAction, PolicyEffect, PolicyRules } from '../../compiler-services/policy/policy-rules.js';
import {
    PolicyBoolOp,
    PolicyCompareOp,
    PolicyNodeKind,
    PolicyRefRoot,
    type PolicyOperand,
    type PolicyPredicate,
    type PolicyRef,
} from '../../compiler-services/policy/policy-predicate.js';
import type { Scalar } from '../../manifest/logical.js';
import { PolicyDiagnosticCode, PolicyScopeCompiler } from '../PolicyScopeCompiler.js';
import type { IPolicyRuleSource } from '../PolicyScopeCompiler.js';
import type { IPrincipalFacts } from '../PrincipalFacts.js';

type FactMap = Record<string, Scalar | readonly Scalar[]>;

class Facts implements IPrincipalFacts
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

/** Builds serialized rule JSON in the shape `PolicyRules.Parse` reads. */
class Rules
{
    public static Entity(member: string): PolicyRef
    {
        return { kind: PolicyNodeKind.Ref, root: PolicyRefRoot.Entity, member };
    }

    public static Principal(member: string): PolicyRef
    {
        return { kind: PolicyNodeKind.Ref, root: PolicyRefRoot.Principal, member };
    }

    public static Lit(value: string | number | boolean): PolicyOperand
    {
        return { kind: PolicyNodeKind.Literal, value };
    }

    public static Eq(left: PolicyOperand, right: PolicyOperand): PolicyPredicate
    {
        return { kind: PolicyNodeKind.Compare, op: PolicyCompareOp.Eq, left, right };
    }

    public static In(collection: PolicyRef, item: PolicyOperand): PolicyPredicate
    {
        return { kind: PolicyNodeKind.Membership, collection, item };
    }

    public static Json(...rules: ReadonlyArray<readonly [string, string, PolicyPredicate]>): string
    {
        return JSON.stringify(rules.map(([effect, action, predicate]) => ({ effect, action, predicate })));
    }
}

/** The evaluator's semantics, inlined: `===` on typed values, unset members are undefined, entity members are scalars. */
class Oracle
{
    private readonly rules: ReturnType<typeof PolicyRules.Parse>;

    public constructor(rulesJson: string, private readonly facts: IPrincipalFacts)
    {
        this.rules = PolicyRules.Parse(rulesJson);
    }

    public Admits(action: PolicyAction, entity: Record<string, unknown>): boolean
    {
        const forAction = this.rules.filter((r) => r.Action === action);
        const allows = forAction.filter((r) => r.Effect === PolicyEffect.Allow);
        const denies = forAction.filter((r) => r.Effect === PolicyEffect.Deny);
        const allowed = allows.length === 0 || allows.some((r) => this.Eval(r.Predicate, entity));
        return allowed && !denies.some((r) => this.Eval(r.Predicate, entity));
    }

    private Eval(node: PolicyPredicate, entity: Record<string, unknown>): boolean
    {
        switch (node.kind)
        {
            case PolicyNodeKind.Compare:
            {
                const eq = this.Value(node.left, entity) === this.Value(node.right, entity);
                return node.op === PolicyCompareOp.Eq ? eq : !eq;
            }
            case PolicyNodeKind.Membership:
            {
                const list = this.Value(node.collection, entity);
                return Array.isArray(list) && list.includes(this.Value(node.item, entity));
            }
            case PolicyNodeKind.Bool:
                return node.op === PolicyBoolOp.And ? this.Eval(node.left, entity) && this.Eval(node.right, entity) : this.Eval(node.left, entity) || this.Eval(node.right, entity);
            case PolicyNodeKind.Not:
                return !this.Eval(node.operand, entity);
        }
    }

    private Value(operand: PolicyOperand, entity: Record<string, unknown>): unknown
    {
        if (operand.kind === PolicyNodeKind.Literal) return operand.value;
        return operand.root === PolicyRefRoot.Entity ? entity[operand.member] : this.facts.Get(operand.member);
    }
}

interface IRow
{
    readonly Id: string;
    readonly Concept: string;
    /** Typed as the runtime holds it: numbers as JS numbers. */
    readonly Entity: Record<string, string | number | boolean>;
}

class Fx
{
    public static readonly A = 'app.A';
    public static readonly B = 'app.B';
    public static readonly Priority = 'priority';
    public static readonly Region = 'region';
    public static readonly Locked = 'locked';

    public static readonly Rows: readonly IRow[] = [
        { Id: 'a1', Concept: Fx.A, Entity: { priority: 5, region: 'eu', locked: false } },
        { Id: 'a2', Concept: Fx.A, Entity: { priority: 6, region: 'eu', locked: true } },
        { Id: 'a3', Concept: Fx.A, Entity: { priority: 5, region: 'us', locked: false } },
        { Id: 'a4', Concept: Fx.A, Entity: {} },
        { Id: 'b1', Concept: Fx.B, Entity: { region: 'eu' } },
    ];

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
                    Name: Fx.A, IsAspect: false, Parent: null, Aspects: [], Members: [
                        Fx.Prop(Fx.Priority, ValueType.Int64),
                        Fx.Prop(Fx.Region, ValueType.String),
                        Fx.Prop(Fx.Locked, ValueType.Boolean),
                        Fx.Prop('owners', ValueType.String),
                    ],
                },
                { Name: Fx.B, IsAspect: false, Parent: null, Aspects: [], Members: [Fx.Prop(Fx.Region, ValueType.String)] },
            ],
            Indexes: [],
            Seed: [],
            Bindings: [],
        };
    }

    public static async Open(): Promise<GraphEngine>
    {
        const engine = await GraphEngine.Open({ Description: Fx.Description(), Storage: { Kind: StorageKind.Memory } });
        const t = await engine.Begin(AccessScope.System);
        for (const row of Fx.Rows)
        {
            t.CreateNode(row.Id, row.Concept);
            for (const [name, value] of Object.entries(row.Entity))
            {
                const cell: CellValue = name === Fx.Priority ? BigInt(value as number) : (value as CellValue);
                t.SetProperty(row.Id, name, cell);
            }
        }
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

    /** The engine-visible ids of `concept` under the compiled `FromRules` scope. */
    public static async Visible(rules: readonly IPolicyRuleSource[], concept: string, facts: FactMap = {}): Promise<string[]>
    {
        const scope = PolicyScopeCompiler.FromRules(rules, Fx.Description()).Compile(new Facts(facts), AccessDefault.Allow);
        const engine = await Fx.Open();
        try
        {
            return await Fx.Scan(engine, scope, concept);
        }
        finally
        {
            await engine.dispose();
        }
    }

    /** The ids the inlined evaluator admits. */
    public static OracleVisible(rulesJson: string, concept: string, facts: FactMap = {}): string[]
    {
        const oracle = new Oracle(rulesJson, new Facts(facts));
        return Fx.Rows.filter((r) => r.Concept === concept && oracle.Admits(PolicyAction.Read, r.Entity)).map((r) => r.Id).sort();
    }

    public static Codes(compiler: PolicyScopeCompiler): PolicyDiagnosticCode[]
    {
        return compiler.Diagnostics.map((d) => d.Code);
    }

    public static Json(predicate: Predicate | undefined): string
    {
        return JSON.stringify(PredicateCodec.ToJson(predicate ?? FalsePredicate.Instance));
    }
}

describe('PolicyScopeCompiler.FromRules', () =>
{
    test('same scope as FromRepository for string rules', () =>
    {
        const source = `namespace app
{
    concept A { priority : integer; region : string; locked : boolean; owners : string; }
    policy A { allow read when entity.region == principal.region; deny write when entity.locked == true; }
}`;
        const { model: repo } = check([{ uri: 'app.todl', text: source }]);
        const rulesJson = String(repo.resolve('app.A@policy')!.attrs.get(Builder.PolicyRulesAttr));
        const facts = new Facts({ region: 'eu' });
        const viaRepo = PolicyScopeCompiler.FromRepository(repo, Fx.Description()).Compile(facts, AccessDefault.Allow);
        const viaRules = PolicyScopeCompiler.FromRules([{ concept: Fx.A, rulesJson }], Fx.Description()).Compile(facts, AccessDefault.Allow);
        assert.notEqual(viaRules.Rows.get(Fx.A), FalsePredicate.Instance);
        assert.equal(Fx.Json(viaRules.Rows.get(Fx.A)), Fx.Json(viaRepo.Rows.get(Fx.A)));
        assert.equal(Fx.Json(viaRules.Writes.get(Fx.A)?.Create), Fx.Json(viaRepo.Writes.get(Fx.A)?.Create));
        assert.equal(Fx.Json(viaRules.Writes.get(Fx.A)?.Update), Fx.Json(viaRepo.Writes.get(Fx.A)?.Update));
        assert.equal(Fx.Json(viaRules.Writes.get(Fx.A)?.Delete), Fx.Json(viaRepo.Writes.get(Fx.A)?.Delete));
    });

    test('number literal matches typed member', async () =>
    {
        const rulesJson = Rules.Json(['allow', 'read', Rules.Eq(Rules.Entity(Fx.Priority), Rules.Lit(5))]);
        const compiler = PolicyScopeCompiler.FromRules([{ concept: Fx.A, rulesJson }], Fx.Description());
        const rows = compiler.Compile(new Facts({}), AccessDefault.Allow).Rows.get(Fx.A);
        // The compare is guarded by presence, as under FromRepository (an unset member must not yield Unknown).
        assert.equal(Fx.Json(rows), Fx.Json(new And([new Not(new IsNull(Fx.Priority)), new Compare(Fx.Priority, CompareOp.Eq, 5n)])));
        assert.deepEqual(compiler.Diagnostics, []);
        const visible = await Fx.Visible([{ concept: Fx.A, rulesJson }], Fx.A);
        assert.deepEqual(visible, ['a1', 'a3']);
        assert.deepEqual(visible, Fx.OracleVisible(rulesJson, Fx.A));
    });

    test('string literal against numeric member never matches', async () =>
    {
        const rulesJson = Rules.Json(['allow', 'read', Rules.Eq(Rules.Entity(Fx.Priority), Rules.Lit('5'))]);
        const compiler = PolicyScopeCompiler.FromRules([{ concept: Fx.A, rulesJson }], Fx.Description());
        assert.equal(compiler.Compile(new Facts({}), AccessDefault.Allow).Rows.get(Fx.A), FalsePredicate.Instance);
        assert.deepEqual(compiler.Diagnostics, []);
        assert.deepEqual(await Fx.Visible([{ concept: Fx.A, rulesJson }], Fx.A), Fx.OracleVisible(rulesJson, Fx.A));
    });

    test('entity membership keeps parity', async () =>
    {
        const rulesJson = Rules.Json(['allow', 'read', Rules.In(Rules.Entity('owners'), Rules.Principal('id'))]);
        const compiler = PolicyScopeCompiler.FromRules([{ concept: Fx.A, rulesJson }], Fx.Description());
        assert.equal(compiler.Compile(new Facts({}), AccessDefault.Allow).Rows.get(Fx.A), FalsePredicate.Instance);
        assert.deepEqual(Fx.Codes(compiler), [PolicyDiagnosticCode.NeverMatches]);
        assert.deepEqual(await Fx.Visible([{ concept: Fx.A, rulesJson }], Fx.A, { id: 'x' }), Fx.OracleVisible(rulesJson, Fx.A, { id: 'x' }));
    });

    test('malformed concept fails closed', async () =>
    {
        const bad = '[{"effect":"maybe"}]';
        const good = Rules.Json(['allow', 'read', Rules.Eq(Rules.Entity(Fx.Region), Rules.Lit('eu'))]);
        const sources: IPolicyRuleSource[] = [{ concept: Fx.A, rulesJson: bad }, { concept: Fx.B, rulesJson: good }];
        const compiler = PolicyScopeCompiler.FromRules(sources, Fx.Description());
        assert.deepEqual(Fx.Codes(compiler), [PolicyDiagnosticCode.MalformedPolicy]);
        assert.equal(compiler.Diagnostics[0]!.Concept, Fx.A);
        const scope = compiler.Compile(new Facts({}), AccessDefault.Allow);
        assert.equal(scope.Rows.get(Fx.A), FalsePredicate.Instance);
        assert.equal(scope.Writes.get(Fx.A)?.Create, FalsePredicate.Instance);
        assert.equal(scope.Writes.get(Fx.A)?.Update, FalsePredicate.Instance);
        assert.equal(scope.Writes.get(Fx.A)?.Delete, FalsePredicate.Instance);
        assert.notEqual(scope.Rows.get(Fx.B), FalsePredicate.Instance);
        assert.deepEqual(await Fx.Visible(sources, Fx.A), []);
        assert.deepEqual(await Fx.Visible(sources, Fx.B), ['b1']);
    });

    test('unknown concept falls to default', () =>
    {
        const compiler = PolicyScopeCompiler.FromRules([{ concept: 'app.Missing', rulesJson: '[]' }], Fx.Description());
        assert.deepEqual(Fx.Codes(compiler), [PolicyDiagnosticCode.UnknownConcept]);
        assert.equal(compiler.Compile(new Facts({}), AccessDefault.Allow).Rows.has('app.Missing'), false);
    });

    test('last entry wins for a repeated concept', async () =>
    {
        const first = Rules.Json(['allow', 'read', Rules.Eq(Rules.Entity(Fx.Region), Rules.Lit('eu'))]);
        const last = Rules.Json(['allow', 'read', Rules.Eq(Rules.Entity(Fx.Region), Rules.Lit('us'))]);
        const sources: IPolicyRuleSource[] = [{ concept: Fx.A, rulesJson: first }, { concept: Fx.A, rulesJson: last }];
        assert.deepEqual(PolicyScopeCompiler.FromRules(sources, Fx.Description()).Diagnostics, []);
        assert.deepEqual(await Fx.Visible(sources, Fx.A), ['a3']);
    });

    test('deny overrides allow', async () =>
    {
        const rulesJson = Rules.Json(
            ['allow', 'read', Rules.Eq(Rules.Entity(Fx.Region), Rules.Principal(Fx.Region))],
            ['deny', 'read', Rules.Eq(Rules.Entity(Fx.Locked), Rules.Lit(true))]);
        const sources: IPolicyRuleSource[] = [{ concept: Fx.A, rulesJson }];
        const eu = await Fx.Visible(sources, Fx.A, { region: 'eu' });
        assert.deepEqual(eu, ['a1']);
        assert.deepEqual(eu, Fx.OracleVisible(rulesJson, Fx.A, { region: 'eu' }));
        const us = await Fx.Visible(sources, Fx.A, { region: 'us' });
        assert.deepEqual(us, ['a3']);
        assert.deepEqual(us, Fx.OracleVisible(rulesJson, Fx.A, { region: 'us' }));
    });
});
