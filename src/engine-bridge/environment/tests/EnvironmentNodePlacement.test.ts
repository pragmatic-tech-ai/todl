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
});
