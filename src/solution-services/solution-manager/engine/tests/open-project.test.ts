import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    FakeStorage,
    Ask,
    ConfirmAsk,
    DurableApplicationStoreKey,
    type IPromptService,
    type IServiceProvider,
    type IPropertyBagStore,
    type IPropertyBag,
    type Disposable,
} from '@pragmatic-tech-ai/todl-runtime';
import { SolutionManagerService } from '../solution-manager-service.js';
import { type IStorageProviderRegistry, type IProjectFactoryRegistry } from '../host-services.js';
import { type INotificationService } from '../notification-service.js';
import { FakeProjectFactory } from './fake-project-factory.js';
import { PROJECT_MANIFEST_FILENAME } from '../../../project-services/core/project-factory.js';

// A stand-in SessionStore: on Register it applies a preset slice to the bag (as the
// real store does once loaded) and holds the bag so a test can read what the manager
// persisted. Change subscriptions count as "scheduled saves".
class FakeSessionStore implements IPropertyBagStore
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
    sessionStore?: IPropertyBagStore;
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
            if (token === DurableApplicationStoreKey) return opts?.sessionStore;
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

// Seed a project.plexus so OpenProject can read the member type.
async function seedProject(roots: Map<string, FakeStorage>, location: string, type: string): Promise<void>
{
    const s = roots.get(location) ?? new FakeStorage(location); roots.set(location, s);
    await s.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify({ type, name: 'p', version: 1 }));
}

test('OpenProject with no active solution creates an untitled ambient solution and adds the member', async () => {
    const { svc, roots } = makeService();
    await seedProject(roots, '/work/api', 'architecture');
    const m = await svc.OpenProject('/work/api');
    assert.equal(svc.ActiveSolution!.HasLocation, false);          // ambient untitled
    assert.equal(svc.ActiveSolution!.Members.ToArray().length, 1);
    assert.equal(m.IsResolved, true);
});

test('OpenProject on an untitled ambient solution leaves it non-dirty', async () => {
    const { svc, roots } = makeService();
    await seedProject(roots, '/work/api', 'architecture');
    await svc.OpenProject('/work/api');
    assert.equal(svc.ActiveSolution!.IsDirty, false);              // loose membership isn't unsaved content
});

test('OpenProject dedupes by location (second call returns the same member)', async () => {
    const { svc, roots } = makeService();
    await seedProject(roots, '/work/api', 'architecture');
    const first = await svc.OpenProject('/work/api');
    const second = await svc.OpenProject('/work/api');
    assert.equal(second, first);
    assert.equal(svc.ActiveSolution!.Members.ToArray().length, 1);
});

test('OpenProject into a titled solution resolves the member under the solution root and dirties it', async () => {
    const { svc, roots } = makeService();
    await svc.NewSolution('/work/sol');                            // titled: Storage.Root === '/work/sol'
    await svc.Save();                                              // clean
    await seedProject(roots, '/work/sol/api', 'architecture');
    const m = await svc.OpenProject('/work/sol/api');
    assert.equal(m.Ref.path, 'api');                              // relative to the solution root
    assert.equal(m.IsResolved, true);
    assert.equal(svc.ActiveSolution!.IsDirty, true);             // titled membership changed
});

test('CloseProject removes the member from the active solution', async () => {
    const { svc, roots } = makeService();
    await seedProject(roots, '/work/api', 'architecture');
    const m = await svc.OpenProject('/work/api');
    await svc.CloseProject(m);
    assert.equal(svc.ActiveSolution!.Members.ToArray().length, 0);
});

test('CloseProject on an untitled solution leaves it non-dirty', async () => {
    const { svc, roots } = makeService();
    await seedProject(roots, '/work/api', 'architecture');
    const m = await svc.OpenProject('/work/api');
    await svc.CloseProject(m);
    assert.equal(svc.ActiveSolution!.IsDirty, false);
});

test('CloseProject with no active solution is a no-op', async () => {
    const { svc } = makeService();
    await assert.doesNotReject(svc.CloseProject({ Ref: { path: 'x', type: 'architecture' } } as never));
});
