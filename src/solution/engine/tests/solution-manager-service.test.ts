import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    FakeStorage,
    Ask,
    ConfirmAsk,
    SessionStoreKey,
    type IPromptService,
    type IServiceProvider,
    type ISessionStore,
    type IPropertyBag,
    type Disposable,
} from '@pragmatic-tech-ai/todl-runtime';
import { SolutionManagerService } from '../solution-manager-service.js';
import { type IStorageProviderRegistry, type IProjectFactoryRegistry } from '../host-services.js';
import { type INotificationService } from '../notification-service.js';
import { FakeProjectFactory } from './fake-project-factory.js';

// A stand-in SessionStore: on Register it applies a preset slice to the bag (as the
// real store does once loaded) and holds the bag so a test can read what the manager
// persisted. Change subscriptions count as "scheduled saves".
class FakeSessionStore implements ISessionStore
{
    public bag: IPropertyBag | undefined;
    public saveScheduled = 0;
    constructor(private readonly slice: Record<string, Record<string, unknown>> = {}) {}
    Register(key: string, bag: IPropertyBag): Disposable
    {
        this.bag = bag;
        const stored = this.slice[key];
        if (stored !== undefined) for (const [n, v] of Object.entries(stored)) bag.SetValue(n, v);
        const subs = [...bag].map(([name]) =>
            bag.Observe(name).subscribe(() => {
                this.saveScheduled++;
            }),
        );
        return {
            dispose: () => {
                for (const s of subs) s.dispose();
            },
        };
    }
    async Restore(): Promise<void> {}
    async Save(): Promise<void>
    {
        this.saveScheduled++;
    }
}

// Records the ambient feedback the manager emits so a test can assert on it.
class RecordingNotifier implements INotificationService
{
    public statuses: string[] = [];
    Status(message: string): void
    {
        this.statuses.push(message);
    }
    Progress(): void {}
    Report(): void {}
}

// A prompt service whose ConfirmAsk answer is scripted; records that it was asked
// so a test can assert the discard prompt actually fired. Every other ask throws.
class ScriptedPrompts implements IPromptService
{
    public asked = 0;
    public foldersPicked = 0;
    constructor(
        private readonly confirm: () => Promise<boolean>,
        private readonly folder: () => Promise<string | undefined> = async () => undefined,
    ) {}
    async Ask<R>(request: Ask<R>): Promise<R>
    {
        if (request instanceof ConfirmAsk)
        {
            this.asked++;
            return (await this.confirm()) as R;
        }
        throw new Error(`unhandled ${request.constructor.name}`);
    }
    Confirm(message: string, confirmLabel?: string): Promise<boolean>
    {
        return this.Ask(new ConfirmAsk(message, confirmLabel));
    }
    PickFolder(): Promise<string | undefined>
    {
        this.foldersPicked++;
        return this.folder();
    }
    PickFile(): Promise<string | undefined>
    {
        throw new Error('nyi');
    }
    PromptText(): Promise<string | undefined>
    {
        throw new Error('nyi');
    }
    Choose<T>(): Promise<T | undefined>
    {
        throw new Error('nyi');
    }
}

// Build the service the way the container does — through the constructor — with
// a fake provider that serves fake host services under the manager's keys.
function makeService(opts?: {
    confirmDiscard?: () => Promise<boolean>;
    notifier?: INotificationService;
    sessionStore?: ISessionStore;
    pickFolder?: () => Promise<string | undefined>;
})
{
    const roots = new Map<string, FakeStorage>();
    const storages: IStorageProviderRegistry = {
        CreateStorage: (folder) => {
            const s = roots.get(folder) ?? new FakeStorage(folder);
            roots.set(folder, s);
            return s;
        },
    };
    const factories: IProjectFactoryRegistry = {
        factoryFor: (type) => (type === 'architecture' ? new FakeProjectFactory() : undefined),
        All: () => [],
    };
    const prompts = new ScriptedPrompts(
        opts?.confirmDiscard ?? (async () => true),
        opts?.pickFolder,
    );
    // Compose is not exercised by these tests, but the ctor now requires the key.
    const packages = {
        resolve: async () => {
            throw new Error('no compose in test');
        },
    };
    const provider = {
        // Notification + SessionStore are resolved optionally (provider.get) —
        // undefined when the host doesn't register one (a headless batch / a test
        // that doesn't opt into session persistence).
        get: (token: unknown) => {
            if (token === SolutionManagerService.NotificationServiceKey) return opts?.notifier;
            if (token === SessionStoreKey) return opts?.sessionStore;
            return undefined;
        },
        getRequired: (token: unknown) => {
            if (token === SolutionManagerService.StorageRegistryKey) return storages;
            if (token === SolutionManagerService.ProjectFactoryRegistryKey) return factories;
            if (token === SolutionManagerService.PromptServiceKey) return prompts;
            if (token === SolutionManagerService.PackageSourceKey) return packages;
            throw new Error('unexpected service key');
        },
        has: () => true,
    } as unknown as IServiceProvider;
    const svc = new SolutionManagerService(provider);
    return { svc, roots, prompts };
}

// Write a valid `<name>.pksln` manifest into a fake root so OpenSolution/
// RestoreSession can read it back — mirrors what Save() would have persisted.
async function seedSolution(
    roots: Map<string, FakeStorage>,
    location: string,
    name: string,
): Promise<void>
{
    const storage = new FakeStorage(location);
    roots.set(location, storage);
    await storage.WriteText(
        `${name}.pksln`,
        JSON.stringify({ kind: 'todl-solution', version: 1, name, members: [], settings: {} }),
    );
}

test('Save emits a Saved status when a notifier is registered', async () => {
    const notifier = new RecordingNotifier();
    const { svc } = makeService({ notifier });
    await svc.NewSolution('/work/a');
    await svc.Save();
    assert.deepEqual(notifier.statuses, ['Saved.']);
});

test('Save works with no notifier registered', async () => {
    const { svc } = makeService(); // no notifier
    await svc.NewSolution('/work/a');
    await svc.Save(); // must not throw
});

test('New → Save writes <name>.pksln; Open reads it back with members', async () => {
    const { svc, roots } = makeService();
    await svc.NewSolution('/work/sol');
    svc.ActiveSolution!.Name = 'My Solution';
    svc.ActiveSolution!.AddMember('./api', 'architecture');
    await svc.Save();

    const stored = await roots.get('/work/sol')!.ReadText('My Solution.pksln');
    assert.match(stored, /todl-solution/);
    assert.match(stored, /\.\/api/);

    await svc.CloseSolution();
    assert.equal(svc.ActiveSolution, undefined);

    await svc.OpenSolution('/work/sol');
    assert.equal(svc.ActiveSolution!.Name, 'My Solution');
    assert.equal(svc.ActiveSolution!.Members.ToArray()[0]!.IsResolved, true);
});

test('Save clears dirty; opening adds to RecentSolutions (move-to-front, deduped)', async () => {
    const { svc } = makeService();
    await svc.NewSolution('/work/sol');
    svc.ActiveSolution!.AddMember('./a', 'architecture');
    assert.equal(svc.ActiveSolution!.IsDirty, true);
    await svc.Save();
    assert.equal(svc.ActiveSolution!.IsDirty, false);
    assert.ok(svc.RecentSolutions.includes('/work/sol'));

    // Save again should not duplicate the recent entry.
    await svc.Save();
    assert.equal(svc.RecentSolutions.filter((p) => p === '/work/sol').length, 1);
});

test('Compose runs members through the injected source and returns diagnostics', async () => {
    const { svc } = makeService(); // fake package source rejects every resolve
    const diagnostics = await svc.Compose([{ model: 'acme.widgets', version: '1.0.0' }]);
    assert.equal(diagnostics.length, 1);
    assert.match(diagnostics[0]!.message, /acme\.widgets/);
});

test('a dirty solution asks to discard and blocks replace when the user declines', async () => {
    const { svc, prompts } = makeService({ confirmDiscard: async () => false }); // user says "don't discard"
    await svc.NewSolution('/work/a');
    svc.ActiveSolution!.AddMember('./x', 'architecture'); // now dirty
    const first = svc.ActiveSolution;
    await svc.NewSolution('/work/b'); // should be blocked by the declined discard
    assert.equal(prompts.asked, 1); // the ConfirmAsk fired through IPromptService
    assert.equal(svc.ActiveSolution, first);
});

test('NewUntitledSolution creates an unsaved, location-less solution', async () => {
    const { svc } = makeService();
    await svc.NewUntitledSolution();
    assert.equal(svc.ActiveSolution!.Name, 'Default Solution');
    assert.equal(svc.ActiveSolution!.HasLocation, false);
    assert.equal(svc.ActiveSolution!.Storage, undefined);
});

test('RestoreSession with no remembered solution creates an untitled one', async () => {
    const store = new FakeSessionStore(); // empty slice → no lastSolution
    const { svc } = makeService({ sessionStore: store });
    await svc.RestoreSession();
    assert.equal(svc.ActiveSolution!.HasLocation, false);
    assert.equal(svc.RecentSolutions.length, 0);
});

test('RestoreSession reopens the remembered last solution', async () => {
    const store = new FakeSessionStore({
        'solution-manager': { lastSolution: '/work/sol', recentSolutions: ['/work/sol'] },
    });
    const { svc, roots } = makeService({ sessionStore: store });
    await seedSolution(roots, '/work/sol', 'Remembered');
    await svc.RestoreSession();
    assert.equal(svc.ActiveSolution!.Name, 'Remembered');
    assert.equal(svc.ActiveSolution!.HasLocation, true);
    assert.ok(svc.RecentSolutions.includes('/work/sol'));
});

test('RestoreSession seeds RecentSolutions from the stored slice', async () => {
    const store = new FakeSessionStore({
        'solution-manager': { lastSolution: '', recentSolutions: ['/a', '/b'] },
    });
    const { svc } = makeService({ sessionStore: store });
    await svc.RestoreSession(); // no lastSolution → untitled, but recents restored
    assert.deepEqual([...svc.RecentSolutions], ['/a', '/b']);
    assert.equal(svc.ActiveSolution!.HasLocation, false);
});

test('RestoreSession falls back to untitled and prunes recents when the last solution is gone', async () => {
    const store = new FakeSessionStore({
        'solution-manager': { lastSolution: '/gone', recentSolutions: ['/gone', '/kept'] },
    });
    const { svc } = makeService({ sessionStore: store }); // '/gone' never seeded → OpenSolution throws
    await svc.RestoreSession();
    assert.equal(svc.ActiveSolution!.HasLocation, false); // fell back to untitled
    assert.deepEqual([...svc.RecentSolutions], ['/kept']); // the dead entry was pruned
    assert.equal(store.bag!.GetValue('lastSolution'), ''); // and forgotten
});

test('opening a solution persists lastSolution + recentSolutions into the session bag', async () => {
    const store = new FakeSessionStore();
    const { svc, roots } = makeService({ sessionStore: store });
    await seedSolution(roots, '/work/sol', 'Persisted');
    await svc.OpenSolution('/work/sol');
    assert.equal(store.bag!.GetValue('lastSolution'), '/work/sol');
    assert.deepEqual(store.bag!.GetValue('recentSolutions'), ['/work/sol']);
});

test('closing a solution clears lastSolution in the session bag', async () => {
    const store = new FakeSessionStore();
    const { svc, roots } = makeService({ sessionStore: store });
    await seedSolution(roots, '/work/sol', 'X');
    await svc.OpenSolution('/work/sol');
    await svc.CloseSolution();
    assert.equal(store.bag!.GetValue('lastSolution'), '');
});

test('Save on an untitled solution picks a folder and persists there', async () => {
    const { svc, roots } = makeService({ pickFolder: async () => '/work/chosen' });
    await svc.NewUntitledSolution();
    svc.ActiveSolution!.Name = 'Fresh';
    await svc.Save(); // untitled → PickFolder → SaveAs('/work/chosen')
    assert.equal(svc.ActiveSolution!.HasLocation, true);
    assert.equal(svc.ActiveSolution!.Storage!.Root, '/work/chosen');
    const stored = await roots.get('/work/chosen')!.ReadText('Fresh.pksln');
    assert.match(stored, /Fresh/);
    assert.ok(svc.RecentSolutions.includes('/work/chosen'));
});

test('Save on an untitled solution is a no-op when the folder pick is cancelled', async () => {
    const { svc } = makeService({ pickFolder: async () => undefined });
    await svc.NewUntitledSolution();
    await svc.Save(); // cancelled → stays untitled, no throw
    assert.equal(svc.ActiveSolution!.HasLocation, false);
});

test('NewSolution takes a user-specified name', async () => {
    const { svc } = makeService();
    await svc.NewSolution('/work/sol', 'Acme Platform');
    assert.equal(svc.ActiveSolution!.Name, 'Acme Platform');
});

test('Save writes the manifest as <name>.pksln, derived from the solution name', async () => {
    const { svc, roots } = makeService();
    await svc.NewSolution('/work/sol', 'Acme Platform');
    await svc.Save();
    assert.equal(await roots.get('/work/sol')!.Exists('Acme Platform.pksln'), true);
});

test('Rename moves the on-disk manifest of a saved solution to <new>.pksln', async () => {
    const { svc, roots } = makeService();
    await svc.NewSolution('/work/sol', 'Old Name');
    await svc.Save();
    const storage = roots.get('/work/sol')!;
    assert.equal(await storage.Exists('Old Name.pksln'), true);

    await svc.Rename('New Name');
    assert.equal(svc.ActiveSolution!.Name, 'New Name');
    assert.equal(await storage.Exists('Old Name.pksln'), false); // old file gone
    assert.equal(await storage.Exists('New Name.pksln'), true); // renamed to the new name

    // Reopening the folder finds the manifest by extension and reads the new name.
    await svc.CloseSolution();
    await svc.OpenSolution('/work/sol');
    assert.equal(svc.ActiveSolution!.Name, 'New Name');
});

test('Rename of an unsaved solution just sets the name (no storage touched)', async () => {
    const { svc } = makeService();
    await svc.NewUntitledSolution();
    await svc.Rename('Named But Unsaved');
    assert.equal(svc.ActiveSolution!.Name, 'Named But Unsaved');
    assert.equal(svc.ActiveSolution!.HasLocation, false);
});
