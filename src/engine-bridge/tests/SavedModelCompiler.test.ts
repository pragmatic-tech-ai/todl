import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { checkAgainst } from '../../compiler-services/api.js';
import { toJSON, type TodlDocument } from '../../compiler-services/emit/json.js';
import type { SourceFile } from '../../compiler-services/diagnostics/span.js';
import { SavedModelCompiler, type ISavedModel } from '../SavedModelCompiler.js';
import { SnapshotDescriber } from '../SnapshotDescriber.js';
import { TodlNames } from '../TodlNames.js';

/** Saved `.todl` sources of a small solution: a shared metamodel, two models in one member file, one in another. */
class SavedFixture
{
    public static readonly Solution = 'demo';
    public static readonly Schema: SourceFile = { uri: 'member1/schema.todl', text: 'namespace s { concept Thing { other : Thing?; } }' };
    public static readonly TwoModels: SourceFile = {
        uri: 'member1/models.todl',
        text: 'namespace m { model One : s { s.Thing t1 { label = "saved"; other = t2; } } model Two : s { s.Thing t2 { } } }',
    };
    public static readonly Other: SourceFile = { uri: 'member2/other.todl', text: 'namespace o { model Three : s { s.Thing t3 { other = m.t1; } } }' };
    public static readonly UnsavedTwoModels: SourceFile = {
        uri: SavedFixture.TwoModels.uri,
        text: 'namespace m { model One : s { s.Thing t1 { label = "unsaved"; } s.Thing fresh { } } model Two : s { s.Thing t2 { } } }',
    };
    public static readonly One = 'm.One';
    public static readonly Two = 'm.Two';
    public static readonly Three = 'o.Three';

    public static Models(): ISavedModel[]
    {
        const member1 = [SavedFixture.Schema, SavedFixture.TwoModels];
        return [
            { ModelId: SavedFixture.One, Namespace: 'm', Sources: member1 },
            { ModelId: SavedFixture.Two, Namespace: 'm', Sources: member1 },
            { ModelId: SavedFixture.Three, Namespace: 'o', Sources: [SavedFixture.Schema, SavedFixture.Other] },
        ];
    }

    /** A published library base carrying its own instance, declared in a model no saved source names. */
    public static LibraryBase(): TodlDocument
    {
        const lib = checkAgainst([], [{ uri: 'lib.todl', text: 'namespace lib { concept Shared { } model Lib : lib { Shared shared { } } }' }]);
        assert.deepEqual(lib.diagnostics, []);
        return toJSON(lib.model);
    }
}

describe('SavedModelCompiler', () =>
{
    test('each instance\'s home is its model id', () =>
    {
        const saved = SavedModelCompiler.Compile(SavedFixture.Models(), [], SavedFixture.Solution);
        assert.deepEqual(saved.Diagnostics, []);
        const snapshot = saved.Snapshot;
        assert.equal(snapshot.HomeModelOf('m.t1'), SavedFixture.One);
        assert.equal(snapshot.HomeModelOf('m.t2'), SavedFixture.Two);
        assert.equal(snapshot.HomeModelOf('o.t3'), SavedFixture.Three);
        assert.equal(snapshot.OriginModelOf('m.t1'), SavedFixture.One, 'no package re-binds another model\'s instance');
        // Cross-model references survive the per-model split.
        assert.deepEqual(snapshot.getNode('m.t1')?.refs?.['other'], ['m.t2']);
        assert.deepEqual(snapshot.getNode('o.t3')?.refs?.['other'], ['m.t1']);
        // Deps-first: a model loads after the models its instances reference; the solution package comes first.
        const order = snapshot.manifests.map((m) => m.model);
        assert.equal(order[0], SavedFixture.Solution);
        assert.ok(order.indexOf(SavedFixture.Two) < order.indexOf(SavedFixture.One));
        assert.ok(order.indexOf(SavedFixture.One) < order.indexOf(SavedFixture.Three));
        assert.ok(saved.Repository.has('m.t1'));
        // The describer the dev host runs over it takes each seed node's Owner from its home: the model id.
        const { Description, Diagnostics } = SnapshotDescriber.Describe(snapshot, { DefaultConnector: TodlNames.FileConnector });
        assert.deepEqual(Diagnostics, []);
        const owners = Description.Seed.filter((n) => n.Concept === 's.Thing').map((n) => [n.PublicId, n.Owner]).sort();
        assert.deepEqual(owners, [['m.t1', SavedFixture.One], ['m.t2', SavedFixture.Two], ['o.t3', SavedFixture.Three]]);
    });

    test('compile uses only the sources given', () =>
    {
        // An editor holds an unsaved buffer for models.todl. Compiling it (as a language service would) leaves the
        // saved compile untouched: the compiler sees only the sources it is handed, and keeps no state between compiles.
        const saved = SavedModelCompiler.Compile(SavedFixture.Models(), [], SavedFixture.Solution);
        const buffered = SavedModelCompiler.Compile(SavedFixture.Models().map((m) => ({
            ...m, Sources: m.Sources.map((s) => s.uri === SavedFixture.UnsavedTwoModels.uri ? SavedFixture.UnsavedTwoModels : s),
        })), [], SavedFixture.Solution);
        assert.equal(buffered.Snapshot.getNode('m.t1')?.attrs['label'], 'unsaved');
        assert.ok(buffered.Snapshot.getNode('m.fresh'));
        assert.equal(saved.Snapshot.getNode('m.t1')?.attrs['label'], 'saved');
        assert.equal(saved.Snapshot.getNode('m.fresh'), undefined);
        assert.equal(saved.Repository.has('m.fresh'), false);
    });

    test('two models of one member are two packages', () =>
    {
        const saved = SavedModelCompiler.Compile(SavedFixture.Models().slice(0, 2), [], SavedFixture.Solution);
        assert.deepEqual(saved.Diagnostics, []);
        const models = saved.Snapshot.manifests.map((m) => m.model).filter((m) => m !== SavedFixture.Solution).sort();
        assert.deepEqual(models, [SavedFixture.One, SavedFixture.Two]);
        assert.equal(saved.Snapshot.HomeModelOf('m.t1'), SavedFixture.One);
        assert.equal(saved.Snapshot.HomeModelOf('m.t2'), SavedFixture.Two);
    });

    test('instance outside any model gets the solution owner', () =>
    {
        // Only m.One is a saved model: m.Two (declared in the same file) and the base library's model are not.
        const saved = SavedModelCompiler.Compile(SavedFixture.Models().slice(0, 1), [SavedFixture.LibraryBase()], SavedFixture.Solution);
        assert.deepEqual(saved.Diagnostics, []);
        assert.equal(saved.Snapshot.HomeModelOf('m.t1'), SavedFixture.One);
        assert.equal(saved.Snapshot.HomeModelOf('m.t2'), SavedFixture.Solution);
        assert.equal(saved.Snapshot.HomeModelOf('lib.shared'), SavedFixture.Solution);
        assert.deepEqual(saved.Snapshot.manifests.map((m) => m.model), [SavedFixture.Solution, SavedFixture.One]);
    });
});
