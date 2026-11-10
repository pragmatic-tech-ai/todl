import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DateValue, MemberKind, ValueType, type IDefinitionDescription, type ISchemaDescription, type MemberInput } from '@pragmatic-tech-ai/graph';
import { WriteAtomicity, WriteConcurrency, type ConnectorBinding } from '../../../model-data/connector-plan.js';
import { EngineBridgeError, EngineBridgeErrorCode } from '../../EngineBridgeError.js';
import type { IExternalBinding } from '../ExternalBinding.js';
import { ExternalIdentity } from '../ExternalIdentity.js';
import { ExternalValues } from '../ExternalValues.js';

class IdentityFixture
{
    public static Prop(name: string, type: ValueType): MemberInput
    {
        return { Name: name, Kind: MemberKind.Property, Type: type, Nullable: true };
    }

    public static Rel(name: string, target: string): MemberInput
    {
        return { Name: name, Kind: MemberKind.Relationship, Targets: [target] };
    }

    public static Def(name: string, members: MemberInput[], parent: string | null = null): IDefinitionDescription
    {
        return { Name: name, IsAspect: false, Parent: parent, Aspects: [], Members: members };
    }

    public static Description(): ISchemaDescription
    {
        return {
            Version: 'v', Indexes: [], Seed: [], Bindings: [],
            Definitions: [
                IdentityFixture.Def('crm.Customer', [IdentityFixture.Prop('id', ValueType.Int64), IdentityFixture.Prop('name', ValueType.String)]),
                IdentityFixture.Def('crm.VipCustomer', [], 'crm.Customer'),
                IdentityFixture.Def('crm.Tag', [IdentityFixture.Prop('code', ValueType.String)]),
                IdentityFixture.Def('crm.Order', [IdentityFixture.Rel('customer', 'crm.Customer'), IdentityFixture.Rel('tag', 'crm.Tag')]),
            ],
        };
    }

    public static Binding(concept: string, source: string, idMember: string, model = 'crm', connector = 'crm'): IExternalBinding
    {
        const binding: ConnectorBinding = {
            Concept: concept, Connector: connector, Source: source, IdKey: 'pk', FieldMap: { [idMember]: 'pk' }, Writable: true,
            Concurrency: WriteConcurrency.LastWriteWins, Atomicity: WriteAtomicity.Sequential,
        };
        return { Model: model, Connector: connector, Binding: binding };
    }
}

describe('ExternalIdentity', () =>
{
    const customers = IdentityFixture.Binding('crm.Customer', 'customers', 'id');
    const tags = IdentityFixture.Binding('crm.Tag', 'tags', 'code');
    const orders = IdentityFixture.Binding('crm.Order', 'orders', 'id');
    const description = IdentityFixture.Description();

    test('mint matches the mirror scheme', () =>
    {
        const identity = new ExternalIdentity(description, [customers]);
        assert.equal(identity.Mint(customers, '42'), 'crm.Customer#crm.customers#42');
    });

    test('storage id with hash round-trips', () =>
    {
        const identity = new ExternalIdentity(description, [customers]);
        assert.deepEqual(identity.Parse(identity.Mint(customers, 'a#b')), { Binding: customers, StorageId: 'a#b' });
    });

    test('parse picks the longest prefix among overlapping bindings', () =>
    {
        const short = IdentityFixture.Binding('crm.Customer', 'a', 'id');
        const long = IdentityFixture.Binding('crm.Customer', 'a.b', 'id');
        const identity = new ExternalIdentity(description, [short, long]);
        assert.equal(identity.Parse('crm.Customer#crm.a.b#1')?.Binding, long);
        assert.equal(identity.Parse('crm.Customer#crm.a#1')?.Binding, short);
    });

    test('foreign prefix does not parse', () =>
    {
        const identity = new ExternalIdentity(description, [customers]);
        assert.equal(identity.Parse('other.X#y.z#1'), undefined);
    });

    test('numeric id key is sent as a number', () =>
    {
        const identity = new ExternalIdentity(description, [customers, tags]);
        assert.equal(identity.StorageKey(customers, '42'), 42);
        assert.equal(identity.StorageKey(tags, '42'), '42');
        assert.equal(identity.StorageKey(customers, 'abc'), 'abc');
    });

    test('storage key keeps only canonical numeric text as a number', () =>
    {
        const floats = IdentityFixture.Binding('crm.Measure', 'm', 'v');
        const defs = [...description.Definitions, IdentityFixture.Def('crm.Measure', [IdentityFixture.Prop('v', ValueType.Float64)])];
        const identity = new ExternalIdentity({ ...description, Definitions: defs }, [customers, floats]);
        assert.equal(identity.StorageKey(floats, '1.5'), 1.5);
        assert.equal(identity.StorageKey(floats, '1.50'), '1.50');
        assert.equal(identity.StorageKey(floats, '1e+21'), 1e21);
        assert.equal(identity.StorageKey(floats, '1e-7'), 1e-7);
        assert.equal(identity.StorageKey(floats, '1e21'), '1e21');
        assert.equal(identity.StorageKey(customers, '1e+21'), '1e+21');
        assert.equal(identity.StorageKey(floats, '0.12345678901234567890'), '0.12345678901234567890');
        assert.equal(identity.StorageKey(customers, '9007199254740993'), '9007199254740993');
        assert.equal(identity.StorageKey(customers, '007'), '007');
        assert.equal(identity.StorageKey(customers, '1.0'), '1.0');
        assert.equal(identity.StorageKey(customers, '-5'), -5);
    });

    test('link target mints through the unique external binding', () =>
    {
        const identity = new ExternalIdentity(description, [customers, orders]);
        assert.equal(identity.LinkTarget(orders, 'customer', 7), 'crm.Customer#crm.customers#7');
        assert.equal(identity.LinkTarget(orders, 'customer', null), undefined);
    });

    test('a subtype-only binding is the unique link target candidate', () =>
    {
        const vip = IdentityFixture.Binding('crm.VipCustomer', 'vips', 'id', 'crm', 'vip');
        const identity = new ExternalIdentity(description, [vip, orders]);
        assert.equal(identity.LinkTarget(orders, 'customer', 3), 'crm.VipCustomer#vip.vips#3');
    });

    test('link target is an engine id when the target is engine-bound', () =>
    {
        const identity = new ExternalIdentity(description, [orders]);
        assert.equal(identity.LinkTarget(orders, 'customer', 'eng-1'), 'eng-1');
    });

    test('ambiguous link target gives no link', () =>
    {
        const other = IdentityFixture.Binding('crm.VipCustomer', 'vips', 'id', 'crm2', 'vip');
        const identity = new ExternalIdentity(description, [customers, other, orders]);
        assert.equal(identity.LinkTarget(orders, 'customer', 7), undefined);
    });

    test('foreign key inverts link target', () =>
    {
        const unique = new ExternalIdentity(description, [customers, orders]);
        assert.equal(unique.ForeignKey(orders, 'customer', unique.LinkTarget(orders, 'customer', 7)!), 7);
        assert.equal(unique.ForeignKey(orders, 'customer', 'eng-1'), 'eng-1');

        const engine = new ExternalIdentity(description, [orders]);
        assert.equal(engine.ForeignKey(orders, 'customer', 'eng-1'), 'eng-1');

        const other = IdentityFixture.Binding('crm.VipCustomer', 'vips', 'id', 'crm2', 'vip');
        const ambiguous = new ExternalIdentity(description, [customers, other, orders]);
        assert.equal(ambiguous.ForeignKey(orders, 'customer', 'x'), 'x');
    });

    test('ambiguous create target throws', () =>
    {
        const twin = IdentityFixture.Binding('crm.Customer', 'customers', 'id', 'crm2', 'twin');
        const identity = new ExternalIdentity(description, [customers, twin]);
        assert.throws(() => identity.CreateTarget('crm.Customer'),
            (e: unknown) => e instanceof EngineBridgeError && e.Code === EngineBridgeErrorCode.AmbiguousExternalBinding);
        assert.throws(() => identity.CreateTarget('crm.Customer'), (e: unknown) => e instanceof Error && e.message.includes('crm (model crm), twin (model crm2)'));
        assert.equal(new ExternalIdentity(description, [customers]).CreateTarget('crm.Customer'), customers);
        assert.equal(new ExternalIdentity(description, [customers]).CreateTarget('crm.Tag'), undefined);
    });

    test('read-only lists non-writable bindings', () =>
    {
        const ro = { ...tags, Binding: { ...tags.Binding, Writable: false } };
        assert.deepEqual(new ExternalIdentity(description, [customers, ro]).ReadOnly(), [ro]);
    });
});

describe('ExternalValues', () =>
{
    test('ToCell converts and rejects', () =>
    {
        assert.equal(ExternalValues.ToCell(ValueType.Int64, '5', 'c.n'), 5n);
        assert.equal(ExternalValues.ToCell(ValueType.Int64, 5, 'c.n'), 5n);
        assert.equal(ExternalValues.ToCell(ValueType.Int64, null, 'c.n'), null);
        assert.throws(() => ExternalValues.ToCell(ValueType.Int64, '5x', 'c.n'),
            (e: unknown) => e instanceof EngineBridgeError && e.Code === EngineBridgeErrorCode.ExternalRowInvalid && e.message.includes('c.n'));
    });

    test('ToCell rejects out-of-range and unrepresentable values', () =>
    {
        assert.throws(() => ExternalValues.ToCell(ValueType.Int64, '9223372036854775808', 'c.n'),
            (e: unknown) => e instanceof EngineBridgeError && e.Code === EngineBridgeErrorCode.ExternalRowInvalid && e.message.includes('IntegerOutOfRange'));
        assert.throws(() => ExternalValues.ToCell(ValueType.Int64, 1.5, 'c.n'),
            (e: unknown) => e instanceof EngineBridgeError && e.Code === EngineBridgeErrorCode.ExternalRowInvalid);
        assert.throws(() => ExternalValues.ToCell(ValueType.String, 5, 'c.n'),
            (e: unknown) => e instanceof EngineBridgeError && e.Code === EngineBridgeErrorCode.ExternalRowInvalid);
    });

    test('ToExternal rejects temporal values', () =>
    {
        assert.throws(() => ExternalValues.ToExternal(new DateValue(1), 'c.d'),
            (e: unknown) => e instanceof EngineBridgeError && e.Code === EngineBridgeErrorCode.UnsupportedExternalChange);
    });

    test('ToExternal', () =>
    {
        assert.equal(ExternalValues.ToExternal(5n, 's'), 5);
        assert.equal(ExternalValues.ToExternal(2n ** 60n, 's'), '1152921504606846976');
        assert.equal(ExternalValues.ToExternal('x', 's'), 'x');
        assert.equal(ExternalValues.ToExternal(null, 's'), null);
    });
});
