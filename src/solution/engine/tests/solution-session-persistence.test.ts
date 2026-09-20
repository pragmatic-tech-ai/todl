import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    ServiceProvider,
    SessionStore,
    FakeStorage,
    EnvironmentKey,
    StorageProviderKey,
    SessionStoreKey,
    Ask,
    ConfirmAsk,
    type IStorage,
    type IEnvironment,
    type IStorageProvider,
    type IPromptService,
} from '@pragmatic-tech-ai/todl-runtime';
import { SolutionManagerService } from '../solution-manager-service.js';
import { type IProjectFactoryRegistry } from '../host-services.js';
import { FakeProjectFactory } from './fake-project-factory.js';

// Integration coverage for the SolutionManager ↔ SessionStore round-trip: the manager
// runs against the REAL todl-runtime SessionStore and a rooted IStorage, and each test
// models one or two application "runs" that share the same storage — the way disk would
// persist session.json + solution.json between launches.

const USER_DIR = '/user';

// A storage backend shared across runs: one FakeStorage per location, kept in a map the
// test owns. session.json (under USER_DIR) and every solution.json therefore survive a
// fresh provider + SessionStore, exactly as files on disk would. Satisfies both the
// SessionStore's IStorageProvider seam and the manager's IStorageProviderRegistry (same
// CreateStorage shape), so one instance backs both.
class SharedStorage implements IStorageProvider {
    constructor(private readonly roots: Map<string, FakeStorage>) {}
    public CreateStorage(location: string): IStorage {
        const existing = this.roots.get(location);
        if (existing !== undefined) return existing;
        const fresh = new FakeStorage(location);
        this.roots.set(location, fresh);
        return fresh;
    }
}

// A prompt service that confirms every discard and cancels every pick — enough for the
// startup/restore paths, which never need a real folder pick.
class AllowPrompts implements IPromptService {
    public async Ask<R>(request: Ask<R>): Promise<R> {
        if (request instanceof ConfirmAsk) return true as R;
        throw new Error(`unhandled ${request.constructor.name}`);
    }
    public Confirm(): Promise<boolean> {
        return Promise.resolve(true);
    }
    public PickFolder(): Promise<string | undefined> {
        return Promise.resolve(undefined);
    }
    public PickFile(): Promise<string | undefined> {
        return Promise.resolve(undefined);
    }
    public PromptText(): Promise<string | undefined> {
        return Promise.resolve(undefined);
    }
    public Choose<T>(): Promise<T | undefined> {
        return Promise.resolve(undefined);
    }
}

// Compose one application "run": a provider wiring the manager against a real SessionStore
// (0ms debounce → deterministic flush) and the shared storage. `roots` is threaded across
// runs to model persistent disk.
function bootRun(roots: Map<string, FakeStorage>): {
    provider: ServiceProvider;
    store: SessionStore;
} {
    const provider = new ServiceProvider();
    const storage = new SharedStorage(roots);
    const factory = new FakeProjectFactory();
    const factories: IProjectFactoryRegistry = {
        factoryFor: (type) => (type === 'architecture' ? factory : undefined),
        All: () => [factory],
    };
    provider.registerInstance(EnvironmentKey, {
        UserDataDirectory: USER_DIR,
    } as unknown as IEnvironment);
    provider.registerInstance(StorageProviderKey, storage);
    provider.registerInstance(SolutionManagerService.StorageRegistryKey, storage);
    provider.registerInstance(SolutionManagerService.ProjectFactoryRegistryKey, factories);
    provider.registerInstance(SolutionManagerService.PromptServiceKey, new AllowPrompts());
    provider.registerInstance(SolutionManagerService.PackageSourceKey, {
        resolve: async () => {
            throw new Error('no compose');
        },
    });
    const store = new SessionStore(provider, 0);
    provider.registerInstance(SessionStoreKey, store);
    return { provider, store };
}

test('a saved solution is remembered and reopened after a restart', async () => {
    const roots = new Map<string, FakeStorage>();

    // Run 1: create + save a named solution, then flush session state to disk.
    const run1 = bootRun(roots);
    const m1 = new SolutionManagerService(run1.provider);
    await run1.store.Restore(); // empty session on first launch
    await m1.NewSolution('/work/proj');
    m1.ActiveSolution!.Name = 'My Work';
    await m1.Save(); // writes solution.json + remembers lastSolution
    await run1.store.Save(); // flush session.json under USER_DIR

    // Run 2: a fresh provider + SessionStore over the SAME storage — a "restart".
    const run2 = bootRun(roots);
    const m2 = new SolutionManagerService(run2.provider);
    await run2.store.Restore(); // reads session.json → applies the slice to m2's bag
    await m2.RestoreSession(); // reopens the remembered solution

    assert.equal(m2.ActiveSolution!.Name, 'My Work');
    assert.equal(m2.ActiveSolution!.HasLocation, true);
    assert.equal(m2.ActiveSolution!.Storage!.Root, '/work/proj');
    assert.deepEqual([...m2.RecentSolutions], ['/work/proj']);
});

test('session.json records lastSolution + recentSolutions under the user dir', async () => {
    const roots = new Map<string, FakeStorage>();
    const run = bootRun(roots);
    const m = new SolutionManagerService(run.provider);
    await run.store.Restore();
    await m.NewSolution('/work/a');
    await m.Save();
    await run.store.Save();

    const doc = JSON.parse(await roots.get(USER_DIR)!.ReadText('session.json'));
    assert.equal(doc['solution-manager'].lastSolution, '/work/a');
    assert.deepEqual(doc['solution-manager'].recentSolutions, ['/work/a']);
});

test('a solution change auto-persists through the debounced save (no explicit flush)', async () => {
    const roots = new Map<string, FakeStorage>();
    const run = bootRun(roots);
    const m = new SolutionManagerService(run.provider);
    await run.store.Restore();
    await m.NewSolution('/work/b');
    await m.Save(); // schedules a debounced session save
    await new Promise((r) => setTimeout(r, 10)); // let the 0ms debounce fire

    const doc = JSON.parse(await roots.get(USER_DIR)!.ReadText('session.json'));
    assert.equal(doc['solution-manager'].lastSolution, '/work/b');
});

test('after a restart, a remembered solution whose folder is gone falls back to untitled and is pruned', async () => {
    const roots = new Map<string, FakeStorage>();

    // Run 1: remember two solutions; '/work/gone' is the most-recent (→ lastSolution).
    const run1 = bootRun(roots);
    const m1 = new SolutionManagerService(run1.provider);
    await run1.store.Restore();
    await m1.NewSolution('/work/kept');
    await m1.Save();
    await m1.NewSolution('/work/gone');
    await m1.Save();
    await run1.store.Save();

    // The '/work/gone' folder disappears from disk before the next launch.
    roots.delete('/work/gone');

    // Run 2: restart. Opening the remembered '/work/gone' throws → untitled fallback.
    const run2 = bootRun(roots);
    const m2 = new SolutionManagerService(run2.provider);
    await run2.store.Restore();
    await m2.RestoreSession();

    assert.equal(m2.ActiveSolution!.HasLocation, false); // fell back to untitled
    assert.deepEqual([...m2.RecentSolutions], ['/work/kept']); // the dead entry was pruned
});

test('with no SessionStore registered, RestoreSession still creates an untitled solution', async () => {
    // Models devUI today: the host persists no session, so the manager resolves no
    // SessionStore and simply starts fresh — no throw, an empty untitled solution.
    const roots = new Map<string, FakeStorage>();
    const provider = new ServiceProvider();
    const storage = new SharedStorage(roots);
    const factories: IProjectFactoryRegistry = { factoryFor: () => undefined, All: () => [] };
    provider.registerInstance(SolutionManagerService.StorageRegistryKey, storage);
    provider.registerInstance(SolutionManagerService.ProjectFactoryRegistryKey, factories);
    provider.registerInstance(SolutionManagerService.PromptServiceKey, new AllowPrompts());
    provider.registerInstance(SolutionManagerService.PackageSourceKey, {
        resolve: async () => {
            throw new Error('no compose');
        },
    });
    // Deliberately no SessionStoreKey / EnvironmentKey / StorageProviderKey.

    const m = new SolutionManagerService(provider);
    await m.RestoreSession();

    assert.equal(m.ActiveSolution!.HasLocation, false);
    assert.equal(m.RecentSolutions.length, 0);
});
