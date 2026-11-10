import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { MemberKind, ValueType, type ISchemaDescription, type MemberInput } from '@pragmatic-tech-ai/graph';
import { WriteAtomicity, WriteConcurrency } from '../../../model-data/connector-plan.js';
import { EngineBridgeError, EngineBridgeErrorCode } from '../../EngineBridgeError.js';
import type { IExternalBinding } from '../../external/ExternalBinding.js';
import { ExternalIdentity } from '../../external/ExternalIdentity.js';
import { EnvironmentNodePlacement } from '../EnvironmentNodePlacement.js';

class PlacementFixture
{
    public static Prop(name: string, type: ValueType): MemberInput
    {
        return { Name: name, Kind: MemberKind.Property, Type: type, Nullable: true };
    }

    public static Description(): ISchemaDescription
    {
        return {
            Version: 'v', Indexes: [], Seed: [], Bindings: [],
            Definitions: [
                { Name: 'crm.Customer', IsAspect: false, Parent: null, Aspects: [], Members: [PlacementFixture.Prop('id', ValueType.Int64)] },
                { Name: 'crm.Tag', IsAspect: false, Parent: null, Aspects: [], Members: [PlacementFixture.Prop('code', ValueType.String)] },
                { Name: 'crm.Gauge', IsAspect: false, Parent: null, Aspects: [], Members: [PlacementFixture.Prop('reading', ValueType.Float64)] },
                { Name: 'crm.Link', IsAspect: false, Parent: null, Aspects: [], Members: [{ Name: 'owner', Kind: MemberKind.Relationship, Targets: ['crm.Tag'] }] },
                { Name: 'crm.Team', IsAspect: false, Parent: null, Aspects: [], Members: [] },
            ],
        };
    }

    public static Binding(concept: string, source: string, idMember: string, model: string): IExternalBinding
    {
        return {
            Model: model, Connector: 'crm',
            Binding: {
                Concept: concept, Connector: 'crm', Source: source, IdKey: 'pk', FieldMap: { [idMember]: 'pk' }, Writable: true,
                Concurrency: WriteConcurrency.LastWriteWins, Atomicity: WriteAtomicity.Sequential,
            },
        };
    }

    public static Placement(bindings: IExternalBinding[]): EnvironmentNodePlacement
    {
        const identity = new ExternalIdentity(PlacementFixture.Description(), bindings);
        return new EnvironmentNodePlacement(identity, new Map([['crm.Team', 'crm-pkg']]), () => 'u1');
    }
}

describe('EnvironmentNodePlacement', () =>
{
    const customers = PlacementFixture.Binding('crm.Customer', 'customers', 'id', 'crm-pkg');
    const tags = PlacementFixture.Binding('crm.Tag', 'tags', 'code', 'crm-pkg');

    test('external create uses the id member when set', () =>
    {
        const place = PlacementFixture.Placement([customers]).Place('crm.Customer', new Map([['id', 9n]]));
        assert.equal(place.PublicId, 'crm.Customer#crm.customers#9');
        assert.equal(place.Owner, 'crm-pkg');
        assert.equal(place.Defaults, undefined);
    });

    test('external create mints a key and defaults the id member', () =>
    {
        const place = PlacementFixture.Placement([tags]).Place('crm.Tag', new Map());
        assert.ok(place.PublicId.endsWith('#u1'));
        assert.equal(place.Defaults?.get('code'), 'u1');
    });

    test('numeric id member is not defaulted', () =>
    {
        const place = PlacementFixture.Placement([customers]).Place('crm.Customer', new Map());
        assert.ok(place.PublicId.endsWith('#u1'));
        assert.equal(place.Defaults, undefined);
    });

    test('engine create owns by home model', () =>
    {
        assert.deepEqual(PlacementFixture.Placement([customers]).Place('crm.Team', new Map()), { PublicId: 'u1', Owner: 'crm-pkg' });
    });

    test('ambiguous external create throws', () =>
    {
        const other = PlacementFixture.Binding('crm.Customer', 'customers2', 'id', 'other');
        assert.throws(
            () => PlacementFixture.Placement([customers, other]).Place('crm.Customer', new Map()),
            (e: unknown) => e instanceof EngineBridgeError && e.Code === EngineBridgeErrorCode.AmbiguousExternalBinding,
        );
    });

    test('null id member behaves as unset', () =>
    {
        const place = PlacementFixture.Placement([tags]).Place('crm.Tag', new Map([['code', null]]));
        assert.equal(place.Defaults?.get('code'), 'u1');
    });

    test('float id member uses its value and is not defaulted', () =>
    {
        const gauges = PlacementFixture.Binding('crm.Gauge', 'gauges', 'reading', 'crm-pkg');
        const placement = PlacementFixture.Placement([gauges]);
        assert.equal(placement.Place('crm.Gauge', new Map([['reading', 1.5]])).PublicId, 'crm.Gauge#crm.gauges#1.5');
        assert.equal(placement.Place('crm.Gauge', new Map()).Defaults, undefined);
    });

    test('unmapped id member mints a key without defaults', () =>
    {
        const binding = PlacementFixture.Binding('crm.Tag', 'tags', 'code', 'crm-pkg');
        const unmapped: IExternalBinding = { ...binding, Binding: { ...binding.Binding, FieldMap: {} } };
        const place = PlacementFixture.Placement([unmapped]).Place('crm.Tag', new Map());
        assert.ok(place.PublicId.endsWith('#u1'));
        assert.equal(place.Defaults, undefined);
    });

    test('relationship id member is not defaulted', () =>
    {
        const links = PlacementFixture.Binding('crm.Link', 'links', 'owner', 'crm-pkg');
        const place = PlacementFixture.Placement([links]).Place('crm.Link', new Map());
        assert.ok(place.PublicId.endsWith('#u1'));
        assert.equal(place.Defaults, undefined);
    });

    test('concept without a home model throws', () =>
    {
        assert.throws(
            () => PlacementFixture.Placement([customers]).Place('crm.Unknown', new Map()),
            (e: unknown) => e instanceof EngineBridgeError && e.Code === EngineBridgeErrorCode.NoHomeModel,
        );
    });

    test('empty or non-scalar id value is rejected', () =>
    {
        const placement = PlacementFixture.Placement([tags]);
        for (const bad of ['', true, new Uint8Array(1), Number.NaN, Number.POSITIVE_INFINITY] as unknown[])
        {
            assert.throws(
                () => placement.Place('crm.Tag', new Map([['code', bad as never]])),
                (e: unknown) => e instanceof EngineBridgeError && e.Code === EngineBridgeErrorCode.UnsupportedValue,
            );
        }
    });
});
