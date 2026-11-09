import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { checkAgainst } from '../../compiler-services/api.js';
import { toJSON, type TodlDocument } from '../../compiler-services/emit/json.js';
import { DiagnosticCode, Severity } from '../../compiler-services/diagnostics/diagnostic.js';
import type { SourceFile } from '../../compiler-services/diagnostics/span.js';
import { EngineBridgeError, EngineBridgeErrorCode } from '../EngineBridgeError.js';
import { SavedModelCompiler, type ISavedModel } from '../SavedModelCompiler.js';
import { SnapshotDescriber } from '../SnapshotDescriber.js';
import { TodlNames } from '../TodlNames.js';

/** Saved `.todl` sources of a small solution: a shared metamodel, two models in one member file, one in another. */
class SavedFixture
{
    public static readonly Solution = 'demo';
    public static readonly Thing = 's.Thing';
    public static readonly Big = 's.Kinds.Big';
    public static readonly ModelsNs = 'm';
    public static readonly OtherNs = 'o';
    public static readonly One = 'm.One';
    public static readonly Two = 'm.Two';
    public static readonly Three = 'o.Three';
    public static readonly T1 = 'm.t1';
    public static readonly T2 = 'm.t2';
    public static readonly T3 = 'o.t3';
    public static readonly Fresh = 'm.fresh';
    public static readonly Bad = 'm.bad';
    public static readonly Ghost = 'm.Ghost';
    public static readonly Shared = 'lib.shared';
    public static readonly Label = 'label';
    public static readonly Other = 'other';
    public static readonly SavedLabel = 'saved';
    public static readonly UnsavedLabel = 'unsaved';
    public static readonly Schema: SourceFile = {
        uri: 'member1/schema.todl',
        text: 'namespace s { concept Thing { other : Thing?; } taxonomy Kinds : represents Thing { term Big { } } }',
    };
    public static readonly TwoModels: SourceFile = {
        uri: 'member1/models.todl',
        text: `namespace m { model One : s { s.Thing t1 { label = "${SavedFixture.SavedLabel}"; other = t2; } } model Two : s { s.Thing t2 { } } }`,
    };
    public static readonly OtherModel: SourceFile = { uri: 'member2/other.todl', text: 'namespace o { model Three : s { s.Thing t3 { other = m.t1; } } }' };
    public static readonly UnsavedTwoModels: SourceFile = {
        uri: SavedFixture.TwoModels.uri,
        text: `namespace m { model One : s { s.Thing t1 { label = "${SavedFixture.UnsavedLabel}"; } s.Thing fresh { } } model Two : s { s.Thing t2 { } } }`,
    };
    /** m.One and m.Two reference each other: a cycle between models. */
    public static readonly Cycle: SourceFile = {
        uri: 'member1/models.todl',
        text: 'namespace m { model One : s { s.Thing t1 { other = t2; } } model Two : s { s.Thing t2 { other = t1; } } }',
    };
    /** A saved file that does not compile: `m.bad` names a concept nobody declares. */
    public static readonly Broken: SourceFile = {
        uri: 'member1/models.todl',
        text: 'namespace m { model One : s { s.Thing t1 { } s.Missing bad { } } }',
    };

    public static Models(): ISavedModel[]
    {
        const member1 = [SavedFixture.Schema, SavedFixture.TwoModels];
        return [
            SavedFixture.Model(SavedFixture.One, member1),
            SavedFixture.Model(SavedFixture.Two, member1),
            { ModelId: SavedFixture.Three, Namespace: SavedFixture.OtherNs, Sources: [SavedFixture.Schema, SavedFixture.OtherModel] },
        ];
    }

    public static Model(modelId: string, sources: readonly SourceFile[]): ISavedModel
    {
        return { ModelId: modelId, Namespace: SavedFixture.ModelsNs, Sources: sources };
    }

    /** A published library base carrying its own instance, declared in a model no saved source names. */
    public static LibraryBase(): TodlDocument
    {
        const lib = checkAgainst([], [{ uri: 'lib.todl', text: 'namespace lib { concept Shared { } model Lib : lib { Shared shared { } } }' }]);
        assert.deepEqual(lib.diagnostics, []);
        return toJSON(lib.model);
    }

    public static Packages(models: readonly ISavedModel[]): string[]
    {
        return SavedModelCompiler.Compile(models, [], SavedFixture.Solution).Snapshot.manifests.map((m) => m.model);
    }
}

describe('SavedModelCompiler', () =>
{
    test('each instance\'s home is its model id', () =>
    {
        const saved = SavedModelCompiler.Compile(SavedFixture.Models(), [], SavedFixture.Solution);
        assert.deepEqual(saved.Diagnostics, []);
        const snapshot = saved.Snapshot;
        assert.equal(snapshot.HomeModelOf(SavedFixture.T1), SavedFixture.One);
        assert.equal(snapshot.HomeModelOf(SavedFixture.T2), SavedFixture.Two);
        assert.equal(snapshot.HomeModelOf(SavedFixture.T3), SavedFixture.Three);
        assert.equal(snapshot.OriginModelOf(SavedFixture.T1), SavedFixture.One, 'no package re-binds another model\'s instance');
        // Cross-model references survive the per-model split.
        assert.deepEqual(snapshot.getNode(SavedFixture.T1)?.refs?.[SavedFixture.Other], [SavedFixture.T2]);
        assert.deepEqual(snapshot.getNode(SavedFixture.T3)?.refs?.[SavedFixture.Other], [SavedFixture.T1]);
        // Deps-first: a model loads after the models its instances reference; the solution package comes first.
        const order = snapshot.manifests.map((m) => m.model);
        assert.equal(order[0], SavedFixture.Solution);
        assert.ok(order.indexOf(SavedFixture.Two) < order.indexOf(SavedFixture.One));
        assert.ok(order.indexOf(SavedFixture.One) < order.indexOf(SavedFixture.Three));
        assert.ok(saved.Repository.has(SavedFixture.T1));
        // The describer the dev host runs over it takes each seed node's Owner from its home: the model id.
        const { Description, Diagnostics } = SnapshotDescriber.Describe(snapshot, { DefaultConnector: TodlNames.FileConnector });
        assert.deepEqual(Diagnostics, []);
        const owners = Description.Seed.filter((n) => n.Concept === SavedFixture.Thing).map((n) => [n.PublicId, n.Owner]).sort();
        assert.deepEqual(owners, [[SavedFixture.T1, SavedFixture.One], [SavedFixture.T2, SavedFixture.Two], [SavedFixture.T3, SavedFixture.Three]]);
    });

    test('compile is pure in its inputs: an unsaved buffer compiled separately leaves the saved compile unchanged', () =>
    {
        // Compile reads only the sources it is handed and keeps no state between compiles. That the handed sources are
        // the SAVED files, never editor buffers, is the caller's guarantee (Task 3's DevSnapshotSource).
        const saved = SavedModelCompiler.Compile(SavedFixture.Models(), [], SavedFixture.Solution);
        const buffered = SavedModelCompiler.Compile(SavedFixture.Models().map((m) => ({
            ...m, Sources: m.Sources.map((s) => s.uri === SavedFixture.UnsavedTwoModels.uri ? SavedFixture.UnsavedTwoModels : s),
        })), [], SavedFixture.Solution);
        assert.equal(buffered.Snapshot.getNode(SavedFixture.T1)?.attrs[SavedFixture.Label], SavedFixture.UnsavedLabel);
        assert.ok(buffered.Snapshot.getNode(SavedFixture.Fresh));
        assert.equal(saved.Snapshot.getNode(SavedFixture.T1)?.attrs[SavedFixture.Label], SavedFixture.SavedLabel);
        assert.equal(saved.Snapshot.getNode(SavedFixture.Fresh), undefined);
        assert.equal(saved.Repository.has(SavedFixture.Fresh), false);
    });

    test('two models of one member are two packages', () =>
    {
        const saved = SavedModelCompiler.Compile(SavedFixture.Models().slice(0, 2), [], SavedFixture.Solution);
        assert.deepEqual(saved.Diagnostics, []);
        const models = saved.Snapshot.manifests.map((m) => m.model).filter((m) => m !== SavedFixture.Solution).sort();
        assert.deepEqual(models, [SavedFixture.One, SavedFixture.Two]);
        assert.equal(saved.Snapshot.HomeModelOf(SavedFixture.T1), SavedFixture.One);
        assert.equal(saved.Snapshot.HomeModelOf(SavedFixture.T2), SavedFixture.Two);
    });

    test('instance outside any model gets the solution owner', () =>
    {
        // Only m.One is a saved model: m.Two (declared in the same file) and the base library's model are not.
        const saved = SavedModelCompiler.Compile(SavedFixture.Models().slice(0, 1), [SavedFixture.LibraryBase()], SavedFixture.Solution);
        assert.deepEqual(saved.Diagnostics, []);
        assert.equal(saved.Snapshot.HomeModelOf(SavedFixture.T1), SavedFixture.One);
        assert.equal(saved.Snapshot.HomeModelOf(SavedFixture.T2), SavedFixture.Solution);
        assert.equal(saved.Snapshot.HomeModelOf(SavedFixture.Shared), SavedFixture.Solution);
        assert.deepEqual(saved.Snapshot.manifests.map((m) => m.model), [SavedFixture.Solution, SavedFixture.One]);
    });

    test('terms and definitions are owned by the solution package', () =>
    {
        const saved = SavedModelCompiler.Compile(SavedFixture.Models(), [], SavedFixture.Solution);
        assert.equal(saved.Snapshot.ownerOf(SavedFixture.Thing)?.model, SavedFixture.Solution);
        const { Description } = SnapshotDescriber.Describe(saved.Snapshot, { DefaultConnector: TodlNames.FileConnector });
        const terms = Description.Seed.filter((n) => n.Concept === TodlNames.Term).map((n) => [n.PublicId, n.Owner]);
        assert.deepEqual(terms, [[SavedFixture.Big, SavedFixture.Solution]]);
        assert.equal(Description.Definitions.filter((d) => d.Name === SavedFixture.Thing).length, 1);
    });

    test('an empty model list compiles to the solution package alone', () =>
    {
        const saved = SavedModelCompiler.Compile([], [], SavedFixture.Solution);
        assert.deepEqual(saved.Diagnostics, []);
        assert.deepEqual(saved.Snapshot.manifests.map((m) => m.model), [SavedFixture.Solution]);
        assert.equal(saved.Snapshot.size, 0);
    });

    test('a reference cycle between models keeps input order and binds both', () =>
    {
        const member1 = [SavedFixture.Schema, SavedFixture.Cycle];
        const models = [SavedFixture.Model(SavedFixture.One, member1), SavedFixture.Model(SavedFixture.Two, member1)];
        const saved = SavedModelCompiler.Compile(models, [], SavedFixture.Solution);
        assert.deepEqual(saved.Diagnostics, []);
        // One is visited first and depends on Two, so Two is emitted first; Two's dependency on One is the visited cycle edge.
        assert.deepEqual(saved.Snapshot.manifests.map((m) => m.model), [SavedFixture.Solution, SavedFixture.Two, SavedFixture.One]);
        assert.deepEqual(saved.Snapshot.getNode(SavedFixture.T1)?.refs?.[SavedFixture.Other], [SavedFixture.T2]);
        assert.deepEqual(saved.Snapshot.getNode(SavedFixture.T2)?.refs?.[SavedFixture.Other], [SavedFixture.T1]);
        assert.equal(saved.Snapshot.HomeModelOf(SavedFixture.T1), SavedFixture.One);
        assert.equal(saved.Snapshot.HomeModelOf(SavedFixture.T2), SavedFixture.Two);
    });

    test('instances of undeclared types are dropped after a failed compile', () =>
    {
        const saved = SavedModelCompiler.Compile([SavedFixture.Model(SavedFixture.One, [SavedFixture.Schema, SavedFixture.Broken])], [], SavedFixture.Solution);
        assert.deepEqual(saved.Diagnostics.map((d) => d.code), [DiagnosticCode.ReferenceUndefined]);
        assert.ok(saved.Repository.has(SavedFixture.Bad), 'the repository keeps what the compiler produced');
        assert.equal(saved.Snapshot.getNode(SavedFixture.Bad), undefined);
        assert.equal(saved.Snapshot.HomeModelOf(SavedFixture.T1), SavedFixture.One);
    });

    test('an undeclared model id is reported and gets no package', () =>
    {
        const models = [SavedFixture.Model(SavedFixture.One, [SavedFixture.Schema, SavedFixture.TwoModels]), SavedFixture.Model(SavedFixture.Ghost, [SavedFixture.Schema])];
        const saved = SavedModelCompiler.Compile(models, [], SavedFixture.Solution);
        assert.deepEqual(saved.Diagnostics.map((d) => [d.code, d.severity, d.node]), [[DiagnosticCode.SavedModelUndeclared, Severity.Warning, SavedFixture.Ghost]]);
        assert.deepEqual(saved.Snapshot.manifests.map((m) => m.model), [SavedFixture.Solution, SavedFixture.One]);
    });

    test('a duplicate model id keeps the first entry and is reported', () =>
    {
        const member1 = [SavedFixture.Schema, SavedFixture.TwoModels];
        const models = [SavedFixture.Model(SavedFixture.One, member1), SavedFixture.Model(SavedFixture.One, member1)];
        const saved = SavedModelCompiler.Compile(models, [], SavedFixture.Solution);
        assert.deepEqual(saved.Diagnostics.map((d) => [d.code, d.severity, d.node]), [[DiagnosticCode.SavedModelDuplicate, Severity.Warning, SavedFixture.One]]);
        assert.deepEqual(SavedFixture.Packages(models), [SavedFixture.Solution, SavedFixture.One]);
    });

    test('a model id equal to the solution name throws', () =>
    {
        const models = [SavedFixture.Model(SavedFixture.Solution, [SavedFixture.Schema])];
        assert.throws(() => SavedModelCompiler.Compile(models, [], SavedFixture.Solution),
            (e: unknown) => e instanceof EngineBridgeError && e.Code === EngineBridgeErrorCode.SolutionModelCollision);
    });
});
