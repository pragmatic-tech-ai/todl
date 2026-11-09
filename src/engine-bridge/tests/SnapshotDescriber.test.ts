import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BindingTable, GraphEngine, MemberKind, StorageKind, ValueType, type IDefinitionDescription, type ISchemaDescription, type ISeedNode, type MemberInput } from '@pragmatic-tech-ai/graph';
import { compilePackage, PackageKind } from '../../publish/publish.js';
import { PackageManifestBridge } from '../../solution-services/package-manager/package-manifest-bridge.js';
import { Domain } from '../../domain/domain.js';
import { MemoryPackageSource } from '../../domain/memory-package-source.js';
import { MetadataSnapshot } from '../../domain/metadata-snapshot.js';
import { Manifest } from '../../manifest/reflection/reflection.js';
import { ManifestWriter } from '../../manifest/manifest-writer.js';
import type { ConceptDef, LogicalManifest } from '../../manifest/logical.js';
import type { ManifestJson } from '../../manifest/records.js';
import { MetaKind } from '../../manifest/enums.js';
import { EngineBridgeError, EngineBridgeErrorCode } from '../EngineBridgeError.js';
import { WriteAtomicity, WriteConcurrency, type ConnectorBinding, type ModelConnectorPlan } from '../../model-data/connector-plan.js';
import { SnapshotDescriber } from '../SnapshotDescriber.js';
import { DescribeDiagnosticCode, type ISnapshotDescription } from '../SnapshotDescription.js';
import { TodlNames } from '../TodlNames.js';

/** Compiles `.todl` sources through the normal Domain path and describes the result. */
class DescribeFixture
{
    public static readonly Model = 'shop.p';
    public static readonly Version = '1.0.0';
    public static readonly BigTerm = 'shop.Kinds.Big';
    /** The canonical digest of the Shop description (terms included); changes only when the description's content does. */
    public static readonly ShopVersion = '9724522078c1e953bb614ab4355e4f57587505460af0c517302ad7c9b66b2f9d';
    public static readonly Shop = `namespace shop
{
    primitive sku : string { }
    primitive qty : integer { }
    primitive opaque { }
    concept Loc { }
    concept Need { must : string; }
    aspect Placed { relationship at -> Loc?; }
    concept Widget : Placed
    {
        name : string?; count : integer?; weight : number?; ok : boolean?;
        code : sku?; amount : qty?; blob : opaque?;
        kind : Kinds?; kinds : Kinds[]; home : Loc?;
        relationship parts -> Widget[];
    }
    taxonomy Kinds : represents Widget { term Big { label = "Big one"; term Huge { } } term Small { } }
    model Shop : shop
    {
        Loc l1 { }
        Widget w0 instanceof Kinds.Big
        {
            name = "w"; count = 3; weight = 1.5; ok = true; code = "AB"; amount = 7; blob = "b";
            kind = Small; kinds = [Big, Huge]; home = l1; parts = [w1]; at = l1;
        }
        Widget w1 { label = "Second"; }
    }
}`;

    public static async Snapshot(sources: readonly { model: string; text: string }[]): Promise<MetadataSnapshot>
    {
        const store = new MemoryPackageSource();
        for (const source of sources)
        {
            const out = compilePackage([], [{ uri: `${source.model}.todl`, text: source.text }], { id: source.model, version: DescribeFixture.Version });
            assert.ok(out.ok, JSON.stringify(out.errors));
            store.Add(PackageManifestBridge.toResolved(out.package!));
        }
        const domain = new Domain(store);
        for (const source of sources)
        {
            await domain.load({ model: source.model, version: DescribeFixture.Version });
        }
        return domain.Snapshot;
    }

    public static async ShopSnapshot(text: string = DescribeFixture.Shop): Promise<MetadataSnapshot>
    {
        return DescribeFixture.Snapshot([{ model: DescribeFixture.Model, text }]);
    }

    public static Describe(snapshot: MetadataSnapshot, plans?: readonly ModelConnectorPlan[]): ISnapshotDescription
    {
        return plans === undefined
            ? SnapshotDescriber.Describe(snapshot, { DefaultConnector: BindingTable.EngineStorage })
            : SnapshotDescriber.Describe(snapshot, { DefaultConnector: BindingTable.EngineStorage, ConnectorPlans: plans });
    }

    public static async Opens(description: ISchemaDescription): Promise<void>
    {
        const engine = await GraphEngine.Open({ Description: description, Storage: { Kind: StorageKind.Memory } });
        assert.equal(engine.SchemaVersion, description.Version);
        await engine.dispose();
    }

    public static Definition(description: ISchemaDescription, name: string): IDefinitionDescription
    {
        const found = description.Definitions.find((d) => d.Name === name);
        assert.ok(found, `definition ${name}`);
        return found;
    }

    public static Member(description: ISchemaDescription, definition: string, name: string): MemberInput
    {
        const found = DescribeFixture.Definition(description, definition).Members.find((m) => m.Name === name);
        assert.ok(found, `member ${definition}.${name}`);
        return found;
    }

    public static Seed(description: ISchemaDescription, id: string): ISeedNode
    {
        const found = description.Seed.find((s) => s.PublicId === id);
        assert.ok(found, `seed ${id}`);
        return found;
    }

    public static Fixture(name: string): string
    {
        return readFileSync(fileURLToPath(new URL(`../../compiler-services/parse/tests/fixtures/${name}`, import.meta.url)), 'utf8');
    }

    public static Binding(concept: string, connector: string): ConnectorBinding
    {
        return {
            Concept: concept, Connector: connector, Source: 'src', IdKey: 'id', FieldMap: {}, Writable: true,
            Concurrency: WriteConcurrency.LastWriteWins, Atomicity: WriteAtomicity.Sequential,
        };
    }

    /** A one-manifest snapshot over `logical`, its JSON view optionally patched before loading. */
    public static Hand(logical: LogicalManifest, patch?: (json: ManifestJson) => void): MetadataSnapshot
    {
        const json = JSON.parse(JSON.stringify(ManifestWriter.fromLogical(logical).toJSON())) as ManifestJson;
        patch?.(json);
        const snapshot = new MetadataSnapshot();
        const manifest = Manifest.load(json);
        snapshot.PreRegister(manifest);
        snapshot.Finalize(manifest);
        return snapshot;
    }

    public static Concept(extendsId: string | null, fields: ConceptDef['fields']): ConceptDef
    {
        return { extends: extendsId, fields, relationships: {}, invariants: [], annotations: [] };
    }
}

describe('SnapshotDescriber', () =>
{
    test('aspects fixture describes parent and aspects', async () =>
    {
        const snapshot = await DescribeFixture.Snapshot([{ model: 'demo.p', text: DescribeFixture.Fixture('aspects.todl') }]);
        const { Description, Diagnostics } = DescribeFixture.Describe(snapshot);
        assert.deepEqual(Diagnostics, []);
        const asset = DescribeFixture.Definition(Description, 'demo.aspects.Asset');
        assert.deepEqual([asset.IsAspect, asset.Parent, asset.Aspects], [true, null, []]);
        assert.deepEqual(asset.Members.map((m) => m.Name), ['tag']);
        const tracked = DescribeFixture.Definition(Description, 'demo.aspects.Tracked');
        assert.deepEqual([tracked.IsAspect, tracked.Parent, tracked.Aspects, tracked.Members], [true, null, ['demo.aspects.Asset'], []]);
        const server = DescribeFixture.Definition(Description, 'demo.aspects.Server');
        assert.deepEqual([server.IsAspect, server.Parent, server.Aspects, server.Members], [false, TodlNames.Element, ['demo.aspects.Tracked'], []]);
        const rack = DescribeFixture.Definition(Description, 'demo.aspects.RackServer');
        assert.deepEqual([rack.Parent, rack.Aspects], ['demo.aspects.Server', []]);
        const root = DescribeFixture.Definition(Description, TodlNames.Element);
        assert.equal(root.Parent, null);
        assert.deepEqual(root.Members.map((m) => m.Name).sort(), ['class', 'description', 'label']);
        assert.equal(Description.Definitions.filter((d) => d.Name === TodlNames.Element).length, 1);
        assert.deepEqual(Description.Indexes, []);
        await DescribeFixture.Opens(Description);
    });

    test('field types map to value types', async () =>
    {
        const { Description, Diagnostics } = DescribeFixture.Describe(await DescribeFixture.ShopSnapshot());
        assert.deepEqual(Diagnostics, []);
        const widget = 'shop.Widget';
        const property = (type: ValueType): MemberInput => ({ Name: '', Kind: MemberKind.Property, Type: type, Nullable: true });
        const expected: [string, MemberInput][] = [
            ['name', property(ValueType.String)],
            ['count', property(ValueType.Int64)],
            ['weight', property(ValueType.Float64)],
            ['ok', property(ValueType.Boolean)],
            ['code', property(ValueType.String)],
            ['amount', property(ValueType.Int64)],
            ['blob', property(ValueType.String)],
            ['kind', property(ValueType.String)],
            ['kinds', { Name: '', Kind: MemberKind.Relationship, Targets: [TodlNames.Term], Many: true, Ordered: true }],
            ['home', { Name: '', Kind: MemberKind.Relationship, Targets: ['shop.Loc'], Many: false }],
            ['parts', { Name: '', Kind: MemberKind.Relationship, Targets: ['shop.Widget'], Many: true, Ordered: true }],
        ];
        for (const [name, member] of expected)
        {
            assert.deepEqual(DescribeFixture.Member(Description, widget, name), { ...member, Name: name }, name);
        }
        assert.deepEqual(DescribeFixture.Member(Description, 'shop.Placed', 'at'), { Name: 'at', Kind: MemberKind.Relationship, Targets: ['shop.Loc'], Many: false });
        const w0 = DescribeFixture.Seed(Description, 'shop.w0');
        assert.deepEqual(w0.Properties, {
            label: 'Big one', class: 'shop.Kinds.Big', name: 'w', count: 3n, weight: 1.5, ok: true,
            code: 'AB', amount: 7n, blob: 'b', kind: 'shop.Kinds.Small',
        });
        assert.deepEqual(w0.Links, [
            { Relationship: 'kinds', To: 'shop.Kinds.Big' },
            { Relationship: 'kinds', To: 'shop.Kinds.Huge' },
            { Relationship: 'home', To: 'shop.l1' },
            { Relationship: 'parts', To: 'shop.w1' },
            { Relationship: 'at', To: 'shop.l1' },
        ]);
        await DescribeFixture.Opens(Description);
    });

    test('missing required value still opens', async () =>
    {
        const snapshot = await DescribeFixture.ShopSnapshot();
        snapshot.BindSeed({ nodes: [{ id: 'shop.n1', type: 'shop.Need', attrs: {} }] }, { model: DescribeFixture.Model, version: DescribeFixture.Version });
        const { Description, Diagnostics } = DescribeFixture.Describe(snapshot);
        assert.deepEqual(Diagnostics, []);
        assert.deepEqual(DescribeFixture.Member(Description, 'shop.Need', 'must'), { Name: 'must', Kind: MemberKind.Property, Type: ValueType.String, Nullable: true });
        assert.deepEqual(DescribeFixture.Seed(Description, 'shop.n1').Properties, { label: null, class: null });
        await DescribeFixture.Opens(Description);
    });

    test('dangling link dropped with diagnostic', async () =>
    {
        const snapshot = await DescribeFixture.ShopSnapshot();
        snapshot.BindSeed({
            nodes: [{ id: 'shop.x', type: 'shop.Widget', attrs: {} }],
            edges: [{ from: 'shop.x', rel: 'parts', to: 'shop.ghost' }, { from: 'shop.x', rel: 'parts', to: 'shop.w1' }],
        }, { model: DescribeFixture.Model, version: DescribeFixture.Version });
        const { Description, Diagnostics } = DescribeFixture.Describe(snapshot);
        assert.deepEqual(Diagnostics.map((d) => [d.Code, d.Subject]), [[DescribeDiagnosticCode.DanglingLink, 'shop.x.parts']]);
        assert.match(Diagnostics[0]!.Message, /shop\.ghost/);
        assert.deepEqual(DescribeFixture.Seed(Description, 'shop.x').Links, [{ Relationship: 'parts', To: 'shop.w1' }]);
        await DescribeFixture.Opens(Description);
    });

    test('type mismatch skipped with diagnostic', async () =>
    {
        const snapshot = await DescribeFixture.ShopSnapshot();
        snapshot.BindSeed({
            nodes: [{ id: 'shop.bad', type: 'shop.Widget', attrs: { name: 5, count: 'abc', weight: 'heavy', ok: 'yes', amount: '2.5', code: 'ok' } }],
        }, { model: DescribeFixture.Model, version: DescribeFixture.Version });
        const { Description, Diagnostics } = DescribeFixture.Describe(snapshot);
        assert.deepEqual(Diagnostics.map((d) => [d.Code, d.Subject]).sort(), [
            [DescribeDiagnosticCode.ValueTypeMismatch, 'shop.bad.count'],
            [DescribeDiagnosticCode.ValueTypeMismatch, 'shop.bad.name'],
            [DescribeDiagnosticCode.ValueTypeMismatch, 'shop.bad.ok'],
            [DescribeDiagnosticCode.ValueTypeMismatch, 'shop.bad.weight'],
            [DescribeDiagnosticCode.NonIntegralInteger, 'shop.bad.amount'],
        ].sort());
        assert.deepEqual(DescribeFixture.Seed(Description, 'shop.bad').Properties, { label: null, class: null, code: 'ok' });
        await DescribeFixture.Opens(Description);
    });

    test('unknown members and concepts are skipped with diagnostics', async () =>
    {
        const snapshot = await DescribeFixture.ShopSnapshot();
        snapshot.BindSeed({
            nodes: [
                { id: 'shop.odd', type: 'shop.Widget', attrs: { bogus: 'x' }, refs: { nowhere: ['shop.w1'] } },
                { id: 'shop.abstract', type: 'shop.Placed', attrs: {} },
            ],
        }, { model: DescribeFixture.Model, version: DescribeFixture.Version });
        const { Description, Diagnostics } = DescribeFixture.Describe(snapshot);
        assert.deepEqual(Diagnostics.map((d) => [d.Code, d.Subject]), [
            [DescribeDiagnosticCode.UnknownConcept, 'shop.abstract'],
            [DescribeDiagnosticCode.UnknownMember, 'shop.odd.bogus'],
            [DescribeDiagnosticCode.UnknownMember, 'shop.odd.nowhere'],
        ]);
        assert.deepEqual(DescribeFixture.Seed(Description, 'shop.odd').Links, []);
        assert.equal(Description.Seed.some((s) => s.PublicId === 'shop.abstract'), false);
        await DescribeFixture.Opens(Description);
    });

    test('class and label are seeded', async () =>
    {
        const { Description } = DescribeFixture.Describe(await DescribeFixture.ShopSnapshot());
        const props = (id: string): [unknown, unknown] =>
        {
            const p = DescribeFixture.Seed(Description, id).Properties;
            return [p[TodlNames.Label], p[TodlNames.Class]];
        };
        assert.deepEqual(props('shop.w0'), ['Big one', 'shop.Kinds.Big']);
        assert.deepEqual(props('shop.w1'), ['Second', null]);
        assert.deepEqual(props('shop.l1'), [null, null]);
        assert.deepEqual(DescribeFixture.Member(Description, TodlNames.Element, TodlNames.Class), { Name: 'class', Kind: MemberKind.Property, Type: ValueType.String, Nullable: true });
        assert.deepEqual(DescribeFixture.Member(Description, TodlNames.Element, TodlNames.Label), { Name: 'label', Kind: MemberKind.Property, Type: ValueType.String, Nullable: true });
    });

    test('terms are seeded with broader', async () =>
    {
        const { Description } = DescribeFixture.Describe(await DescribeFixture.ShopSnapshot());
        const term = DescribeFixture.Definition(Description, TodlNames.Term);
        assert.deepEqual([term.Parent, term.IsAspect, term.Aspects], [TodlNames.Element, false, []]);
        assert.deepEqual(term.Members, [
            { Name: 'taxonomy', Kind: MemberKind.Property, Type: ValueType.String, Nullable: true },
            { Name: 'broader', Kind: MemberKind.Relationship, Targets: [TodlNames.Term], Many: true, Ordered: true },
        ]);
        const terms = Description.Seed.filter((s) => s.Concept === TodlNames.Term);
        assert.deepEqual(terms.map((t) => t.PublicId), ['shop.Kinds.Big', 'shop.Kinds.Huge', 'shop.Kinds.Small']);
        assert.deepEqual(DescribeFixture.Seed(Description, 'shop.Kinds.Big').Properties, { label: 'Big one', class: null, taxonomy: 'shop.Kinds' });
        assert.deepEqual(DescribeFixture.Seed(Description, 'shop.Kinds.Huge').Properties, { label: null, class: null, taxonomy: 'shop.Kinds' });
        assert.deepEqual(DescribeFixture.Seed(Description, 'shop.Kinds.Huge').Links, [{ Relationship: 'broader', To: 'shop.Kinds.Big' }]);
        assert.deepEqual(DescribeFixture.Seed(Description, 'shop.Kinds.Big').Links, []);
        assert.ok(terms.every((t) => t.Owner === DescribeFixture.Model));
    });

    test('owner is the binding package model', async () =>
    {
        const snapshot = await DescribeFixture.Snapshot([
            { model: 'pkg.a', text: 'namespace a { concept A { } model MA : a { A a1 { } } }' },
            { model: 'pkg.b', text: 'namespace b { concept B { } model MB : b { B b1 { } } }' },
        ]);
        const { Description, Diagnostics } = DescribeFixture.Describe(snapshot);
        assert.deepEqual(Diagnostics, []);
        assert.equal(DescribeFixture.Seed(Description, 'a.a1').Owner, 'pkg.a');
        assert.equal(DescribeFixture.Seed(Description, 'b.b1').Owner, 'pkg.b');
        assert.equal(snapshot.HomeModelOf('b.b1'), 'pkg.b');
        assert.equal(Description.Definitions.filter((d) => d.Name === TodlNames.Element).length, 1);
        await DescribeFixture.Opens(Description);
    });

    test('version is stable and content-sensitive', async () =>
    {
        const version = async (text: string): Promise<string> => DescribeFixture.Describe(await DescribeFixture.ShopSnapshot(text)).Description.Version;
        const base = await version(DescribeFixture.Shop);
        assert.match(base, /^[0-9a-f]{64}$/);
        assert.equal(await version(DescribeFixture.Shop), base);
        assert.equal(await version(DescribeFixture.Shop.replace('count = 3;', 'count   =   3 ;\n')), base);
        assert.notEqual(await version(DescribeFixture.Shop.replace('count = 3;', 'count = 4;')), base);
    });

    test('version of a term-bearing description is a pinned literal digest', async () =>
    {
        const { Description } = DescribeFixture.Describe(await DescribeFixture.ShopSnapshot(DescribeFixture.Shop));
        assert.ok(Description.Seed.some((n) => n.PublicId === DescribeFixture.BigTerm), 'the fixture carries taxonomy terms');
        assert.equal(Description.Version, DescribeFixture.ShopVersion);
    });

    test('external binding goes to External, not Bindings', async () =>
    {
        const plan: ModelConnectorPlan = {
            Model: DescribeFixture.Model, Version: DescribeFixture.Version, Connectors: [],
            Bindings: [DescribeFixture.Binding('shop.Loc', 'crm'), DescribeFixture.Binding('shop.Widget', TodlNames.FileConnector)],
        };
        const { Description, External } = DescribeFixture.Describe(await DescribeFixture.ShopSnapshot(), [plan]);
        assert.deepEqual(Description.Bindings, [{ Model: DescribeFixture.Model, Concept: 'shop.Widget', Connector: TodlNames.FileConnector }]);
        assert.deepEqual([...External], ['shop.Loc']);
        assert.equal(Description.DefaultConnector, BindingTable.EngineStorage);
    });

    test('a disagreeing redeclaration is dropped with a diagnostic, an agreeing one silently', async () =>
    {
        const logical: LogicalManifest = {
            format: 'todl-manifest/1', model: 'm', version: '1.0.0', root: TodlNames.Element,
            concepts: {
                [TodlNames.Element]: DescribeFixture.Concept(null, { label: { type: 'string', card: '?' } }),
                'm.Base': DescribeFixture.Concept(TodlNames.Element, { x: { type: 'string', card: '?' } }),
                'm.Same': DescribeFixture.Concept('m.Base', { x: { type: 'string', card: '1' }, label: { type: 'string', card: '1' } }),
                'm.Other': DescribeFixture.Concept('m.Base', { x: { type: 'integer', card: '?' } }),
            },
            classes: {}, taxonomies: {},
        };
        const snapshot = DescribeFixture.Hand(logical);
        snapshot.BindSeed({ nodes: [{ id: 'o1', type: 'm.Other', attrs: { x: 'text' } }] }, { model: 'm', version: '1.0.0' });
        const { Description, Diagnostics } = DescribeFixture.Describe(snapshot);
        assert.deepEqual(Diagnostics.map((d) => [d.Code, d.Subject]), [[DescribeDiagnosticCode.MemberRedeclared, 'm.Other.x']]);
        assert.deepEqual(DescribeFixture.Definition(Description, 'm.Same').Members, []);
        assert.deepEqual(DescribeFixture.Definition(Description, 'm.Other').Members, []);
        assert.deepEqual(DescribeFixture.Seed(Description, 'o1').Properties, { label: null, class: null, x: 'text' });
        await DescribeFixture.Opens(Description);
    });

    test('a field type with no engine value type throws naming type and field', () =>
    {
        const logical: LogicalManifest = {
            format: 'todl-manifest/1', model: 'm', version: '1.0.0', root: TodlNames.Element,
            concepts: { 'm.W': DescribeFixture.Concept(null, { odd: { type: 'm.Weird', card: '?' } }) },
            classes: {}, taxonomies: {},
        };
        // Retype the synthesized `m.Weird` row as an annotation: a type kind no member can hold.
        const snapshot = DescribeFixture.Hand(logical, (json) =>
        {
            const name = json.strings.indexOf('Weird');
            const row = json.tables.TypeInfo.find((r) => r[0] === name)!;
            row[2] = MetaKind.Annotation;
        });
        assert.throws(() => DescribeFixture.Describe(snapshot), (error: unknown) =>
            error instanceof EngineBridgeError && error.Code === EngineBridgeErrorCode.UnsupportedFieldType
            && error.message.includes('m.W.odd') && error.message.includes('m.Weird'));
    });

    test('integers outside the Int64 range are skipped with a diagnostic', async () =>
    {
        const snapshot = await DescribeFixture.ShopSnapshot();
        snapshot.BindSeed({
            nodes: [
                { id: 'shop.big', type: 'shop.Widget', attrs: { count: '99999999999999999999', amount: 1e20, name: 'ok' } },
                { id: 'shop.unsafe', type: 'shop.Widget', attrs: { count: 2 ** 53 + 2, amount: '1e17' } },
                { id: 'shop.exact', type: 'shop.Widget', attrs: { count: '9007199254740993', amount: '-9223372036854775808' } },
            ],
        }, { model: DescribeFixture.Model, version: DescribeFixture.Version });
        const { Description, Diagnostics } = DescribeFixture.Describe(snapshot);
        assert.deepEqual(Diagnostics.map((d) => [d.Code, d.Subject]), [
            [DescribeDiagnosticCode.IntegerOutOfRange, 'shop.big.count'],
            [DescribeDiagnosticCode.IntegerOutOfRange, 'shop.big.amount'],
            [DescribeDiagnosticCode.IntegerOutOfRange, 'shop.unsafe.count'],
            [DescribeDiagnosticCode.IntegerOutOfRange, 'shop.unsafe.amount'],
        ]);
        assert.deepEqual(DescribeFixture.Seed(Description, 'shop.big').Properties, { label: null, class: null, name: 'ok' });
        assert.deepEqual(DescribeFixture.Seed(Description, 'shop.unsafe').Properties, { label: null, class: null });
        // Decimal digit strings convert exactly, past 2^53 and up to the Int64 bounds.
        assert.deepEqual(DescribeFixture.Seed(Description, 'shop.exact').Properties,
            { label: null, class: null, count: 9007199254740993n, amount: -9223372036854775808n });
        await DescribeFixture.Opens(Description);
    });

    test('owner is the home package, not a re-binding dependent or the type declarer; terms dedupe across manifests', async () =>
    {
        const a = compilePackage([], [{ uri: 'a.todl', text: 'namespace a { concept A { } taxonomy K : represents A { term T { } } model MA : a { A a1 { } } }' }],
            { id: 'pkg.a', version: DescribeFixture.Version });
        assert.ok(a.ok, JSON.stringify(a.errors));
        const b = compilePackage([a.package!.document], [{ uri: 'b.todl', text: 'namespace b { import a; model MB : a { a.A b1 { } } }' }],
            { id: 'pkg.b', version: DescribeFixture.Version }, [{ kind: PackageKind.Library, id: 'pkg.a', version: DescribeFixture.Version }]);
        assert.ok(b.ok, JSON.stringify(b.errors));
        const domain = new Domain(new MemoryPackageSource([PackageManifestBridge.toResolved(a.package!), PackageManifestBridge.toResolved(b.package!)]));
        await domain.load({ model: 'pkg.b', version: DescribeFixture.Version });
        const snapshot = domain.Snapshot;
        assert.deepEqual(snapshot.manifests.map((m) => m.model), ['pkg.a', 'pkg.b']);
        assert.equal(snapshot.ownerOf('a.A')?.model, 'pkg.a');
        const { Description, Diagnostics } = DescribeFixture.Describe(snapshot);
        assert.deepEqual(Diagnostics, []);
        assert.equal(DescribeFixture.Seed(Description, 'b.b1').Owner, 'pkg.b');
        // a.a1 is declared in pkg.a; pkg.b's full-closure seed re-binds it (last binder), but its home stays pkg.a.
        assert.equal(snapshot.OriginModelOf('a.a1'), 'pkg.b');
        assert.equal(DescribeFixture.Seed(Description, 'a.a1').Owner, 'pkg.a');
        const terms = Description.Seed.filter((s) => s.Concept === TodlNames.Term);
        assert.deepEqual(terms.map((t) => [t.PublicId, t.Owner]), [['a.K.T', 'pkg.a']]);
        assert.equal(Description.Definitions.filter((d) => d.Name === 'a.A').length, 1);
        await DescribeFixture.Opens(Description);
    });

    test('a node no package bound is skipped as unattributed', async () =>
    {
        const snapshot = await DescribeFixture.ShopSnapshot();
        snapshot.heap.add({ id: 'shop.stray', type: 'shop.Loc', attrs: {} });
        const { Description, Diagnostics } = DescribeFixture.Describe(snapshot);
        assert.deepEqual(Diagnostics.map((d) => [d.Code, d.Subject]), [[DescribeDiagnosticCode.Unattributed, 'shop.stray']]);
        assert.equal(Description.Seed.some((s) => s.PublicId === 'shop.stray'), false);
    });

    test('a single-card taxonomy field naming several terms keeps the first with a diagnostic', async () =>
    {
        const snapshot = await DescribeFixture.ShopSnapshot();
        snapshot.BindSeed({
            nodes: [{ id: 'shop.two', type: 'shop.Widget', attrs: {} }],
            edges: [{ from: 'shop.two', rel: 'kind', to: 'shop.Kinds.Big' }, { from: 'shop.two', rel: 'kind', to: 'shop.Kinds.Small' }],
        }, { model: DescribeFixture.Model, version: DescribeFixture.Version });
        const { Description, Diagnostics } = DescribeFixture.Describe(snapshot);
        assert.deepEqual(Diagnostics.map((d) => [d.Code, d.Subject]), [[DescribeDiagnosticCode.ValueTypeMismatch, 'shop.two.kind']]);
        assert.equal(DescribeFixture.Seed(Description, 'shop.two').Properties['kind'], 'shop.Kinds.Big');
    });

    test('plan bindings are deduplicated and validated', async () =>
    {
        const plans: ModelConnectorPlan[] = [
            {
                Model: DescribeFixture.Model, Version: DescribeFixture.Version, Connectors: [],
                Bindings: [
                    DescribeFixture.Binding('shop.Widget', TodlNames.FileConnector),
                    DescribeFixture.Binding('shop.Widget', TodlNames.FileConnector),
                    DescribeFixture.Binding('shop.Widget', 'crm'),
                    DescribeFixture.Binding('shop.Nothing', TodlNames.FileConnector),
                    DescribeFixture.Binding('shop.Placed', 'crm'),
                ],
            },
            { Model: '', Version: DescribeFixture.Version, Connectors: [], Bindings: [DescribeFixture.Binding('shop.Loc', TodlNames.FileConnector)] },
        ];
        const { Description, External, Diagnostics } = DescribeFixture.Describe(await DescribeFixture.ShopSnapshot(), plans);
        assert.deepEqual(Description.Bindings, [{ Model: DescribeFixture.Model, Concept: 'shop.Widget', Connector: TodlNames.FileConnector }]);
        assert.deepEqual([...External], []);
        assert.deepEqual(Diagnostics.map((d) => [d.Code, d.Subject]), [
            [DescribeDiagnosticCode.DuplicateBinding, 'shop.Widget'],
            [DescribeDiagnosticCode.InvalidBinding, 'shop.Nothing'],
            [DescribeDiagnosticCode.InvalidBinding, 'shop.Placed'],
            [DescribeDiagnosticCode.InvalidBinding, 'shop.Loc'],
        ]);
    });

    test('unresolved field types and targets fall back with diagnostics', async () =>
    {
        const logical: LogicalManifest = {
            format: 'todl-manifest/1', model: 'm', version: '1.0.0', root: TodlNames.Element,
            concepts: {
                'm.W': {
                    ...DescribeFixture.Concept(null, { lost: { type: 'm.Gone', card: '?' } }),
                    relationships: { nowhere: { targets: [], card: '*', annotations: [] } },
                },
            },
            classes: {}, taxonomies: {},
        };
        // Clear the field's coded type so it resolves to nothing, as an unresolved cross-manifest ref does.
        const snapshot = DescribeFixture.Hand(logical, (json) =>
        {
            json.tables.Field[0]![1] = 0;
        });
        snapshot.BindSeed({ nodes: [{ id: 'w1', type: 'm.W', attrs: { lost: 'kept' } }] }, { model: 'm', version: '1.0.0' });
        const { Description, Diagnostics } = DescribeFixture.Describe(snapshot);
        assert.deepEqual(Diagnostics.map((d) => [d.Code, d.Subject]), [
            [DescribeDiagnosticCode.UnresolvedType, 'm.W.lost'],
            [DescribeDiagnosticCode.UnresolvedType, 'm.W.nowhere'],
        ]);
        assert.deepEqual(DescribeFixture.Member(Description, 'm.W', 'lost'), { Name: 'lost', Kind: MemberKind.Property, Type: ValueType.String, Nullable: true });
        assert.deepEqual(DescribeFixture.Member(Description, 'm.W', 'nowhere').Targets, [TodlNames.Element]);
        assert.equal(DescribeFixture.Seed(Description, 'w1').Properties['lost'], 'kept');
        await DescribeFixture.Opens(Description);
    });

    test('a term value that does not fit is skipped with a diagnostic', async () =>
    {
        const logical: LogicalManifest = {
            format: 'todl-manifest/1', model: 'm', version: '1.0.0', root: TodlNames.Element,
            concepts: {
                [TodlNames.Element]: DescribeFixture.Concept(null, { label: { type: 'string', card: '?' } }),
                'm.W': DescribeFixture.Concept(TodlNames.Element, {}),
            },
            classes: { 'm.K.t': { concept: 'm.W', taxonomy: 'm.K', narrower: [], fixed: { label: 5 }, annotations: [] } },
            taxonomies: { 'm.K': { represents: ['m.W'], roots: ['m.K.t'] } },
        };
        const { Description, Diagnostics } = DescribeFixture.Describe(DescribeFixture.Hand(logical));
        assert.deepEqual(Diagnostics.map((d) => [d.Code, d.Subject]), [[DescribeDiagnosticCode.ValueTypeMismatch, 'm.K.t.label']]);
        assert.deepEqual(DescribeFixture.Seed(Description, 'm.K.t').Properties, { label: null, class: null, taxonomy: 'm.K' });
    });
});

/** Hand-built manifests whose type model is broken the way a compile-diagnosed model can be (ruling PF-b). */
class BrokenTypeModelFx
{
    public static readonly Model = 'm';
    public static readonly Version = '1.0.0';
    public static readonly Format = 'todl-manifest/1';
    public static readonly Str: ConceptDef['fields'][string] = { type: 'string', card: '?' };

    public static Aspect(fields: ConceptDef['fields'], aspects: string[] = []): NonNullable<LogicalManifest['aspects']>[string]
    {
        return { fields, relationships: {}, aspects, invariants: [], annotations: [] };
    }

    public static Carrier(extendsId: string, aspects: string[], fields: ConceptDef['fields'] = {}): ConceptDef
    {
        return { ...DescribeFixture.Concept(extendsId, fields), aspects };
    }

    public static Snapshot(concepts: LogicalManifest['concepts'], aspects: NonNullable<LogicalManifest['aspects']> = {}): MetadataSnapshot
    {
        return DescribeFixture.Hand({
            format: BrokenTypeModelFx.Format, model: BrokenTypeModelFx.Model, version: BrokenTypeModelFx.Version, root: TodlNames.Element,
            concepts: { [TodlNames.Element]: DescribeFixture.Concept(null, { label: BrokenTypeModelFx.Str }), ...concepts },
            aspects, classes: {}, taxonomies: {},
        });
    }

    public static Codes(description: ISnapshotDescription): [DescribeDiagnosticCode, string][]
    {
        return description.Diagnostics.map((d) => [d.Code, d.Subject]);
    }
}

describe('SnapshotDescriber type-model collisions and cycles (PF-b)', () =>
{
    test('two aspects declaring the same member: the later one drops it, the engine opens', async () =>
    {
        const snapshot = BrokenTypeModelFx.Snapshot(
            { 'm.B': BrokenTypeModelFx.Carrier(TodlNames.Element, ['m.A1', 'm.A2']) },
            { 'm.A1': BrokenTypeModelFx.Aspect({ x: BrokenTypeModelFx.Str }), 'm.A2': BrokenTypeModelFx.Aspect({ x: BrokenTypeModelFx.Str, z: BrokenTypeModelFx.Str }) });
        snapshot.BindSeed({ nodes: [{ id: 'b1', type: 'm.B', attrs: { x: 'v', z: 'w' } }] }, { model: BrokenTypeModelFx.Model, version: BrokenTypeModelFx.Version });
        const described = DescribeFixture.Describe(snapshot);
        assert.deepEqual(BrokenTypeModelFx.Codes(described), [[DescribeDiagnosticCode.MemberCollision, 'm.A2.x']]);
        assert.deepEqual(DescribeFixture.Definition(described.Description, 'm.A1').Members.map((m) => m.Name), ['x']);
        assert.deepEqual(DescribeFixture.Definition(described.Description, 'm.A2').Members.map((m) => m.Name), ['z']);
        assert.deepEqual(DescribeFixture.Seed(described.Description, 'b1').Properties, { label: null, class: null, x: 'v', z: 'w' });
        await DescribeFixture.Opens(described.Description);
    });

    test('a parent and an aspect declaring the same member: the parent wins, the engine opens', async () =>
    {
        const snapshot = BrokenTypeModelFx.Snapshot(
            {
                'm.P': DescribeFixture.Concept(TodlNames.Element, { y: BrokenTypeModelFx.Str }),
                'm.C': BrokenTypeModelFx.Carrier('m.P', ['m.A']),
            },
            { 'm.A': BrokenTypeModelFx.Aspect({ y: BrokenTypeModelFx.Str }) });
        const described = DescribeFixture.Describe(snapshot);
        assert.deepEqual(BrokenTypeModelFx.Codes(described), [[DescribeDiagnosticCode.MemberCollision, 'm.A.y']]);
        assert.deepEqual(DescribeFixture.Definition(described.Description, 'm.P').Members.map((m) => m.Name), ['y']);
        assert.deepEqual(DescribeFixture.Definition(described.Description, 'm.A').Members, []);
        await DescribeFixture.Opens(described.Description);
    });

    test('an aspect inclusion cycle: the closing inclusion is dropped, the engine opens', async () =>
    {
        const snapshot = BrokenTypeModelFx.Snapshot(
            { 'm.C': BrokenTypeModelFx.Carrier(TodlNames.Element, ['m.A1']) },
            { 'm.A1': BrokenTypeModelFx.Aspect({ a: BrokenTypeModelFx.Str }, ['m.A2']), 'm.A2': BrokenTypeModelFx.Aspect({ b: BrokenTypeModelFx.Str }, ['m.A1']) });
        const described = DescribeFixture.Describe(snapshot);
        assert.deepEqual(BrokenTypeModelFx.Codes(described), [[DescribeDiagnosticCode.InheritanceCycle, 'm.A2']]);
        assert.deepEqual(DescribeFixture.Definition(described.Description, 'm.A1').Aspects, ['m.A2']);
        assert.deepEqual(DescribeFixture.Definition(described.Description, 'm.A2').Aspects, []);
        await DescribeFixture.Opens(described.Description);
    });

    test('an extends cycle: the closing parent edge falls back to the root, the engine opens', async () =>
    {
        const snapshot = BrokenTypeModelFx.Snapshot({
            'm.X': DescribeFixture.Concept('m.Y', { x: BrokenTypeModelFx.Str }),
            'm.Y': DescribeFixture.Concept('m.X', { y: BrokenTypeModelFx.Str }),
        });
        const described = DescribeFixture.Describe(snapshot);
        assert.deepEqual(BrokenTypeModelFx.Codes(described).map(([code]) => code), [DescribeDiagnosticCode.InheritanceCycle]);
        const parents = ['m.X', 'm.Y'].map((name) => DescribeFixture.Definition(described.Description, name).Parent);
        assert.equal(parents.filter((p) => p === TodlNames.Element).length, 1);
        await DescribeFixture.Opens(described.Description);
    });
});

class SeedPropertiesFx
{
    public static readonly Members = [
        { Name: 'n', Kind: MemberKind.Property, Type: ValueType.Int64 },
        { Name: 's', Kind: MemberKind.Property, Type: ValueType.String },
        { Name: 'r', Kind: MemberKind.Relationship },
    ];
    public static readonly Cls = 'm.Premium';
}

test('SeedProperties converts attrs as the seed does, defaulting label and class and skipping what does not fit', () =>
{
    const attrs = new Map<string, string | number | boolean>([['n', '42'], ['s', 'x'], ['r', 'y'], ['other', 'z']]);
    const properties = SnapshotDescriber.SeedProperties(SeedPropertiesFx.Members, attrs, SeedPropertiesFx.Cls);
    assert.deepEqual([...properties], [[TodlNames.Label, null], [TodlNames.Class, SeedPropertiesFx.Cls], ['n', 42n], ['s', 'x']]);
    const mismatched = SnapshotDescriber.SeedProperties(SeedPropertiesFx.Members, new Map([['n', 'not a number']]), null);
    assert.deepEqual([...mismatched], [[TodlNames.Label, null], [TodlNames.Class, null]]);
});
