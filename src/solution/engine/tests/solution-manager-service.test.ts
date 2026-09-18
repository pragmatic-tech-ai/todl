import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FakeStorage, Ask, ConfirmAsk, type IPromptService, type IServiceProvider } from '@pragmatic-tech-ai/todl-runtime'
import { SolutionManagerService } from '../solution-manager-service.js'
import {
    type IStorageProviderRegistry,
    type IProjectFactoryRegistry,
} from '../host-services.js'
import { type INotificationService } from '../notification-service.js'
import { FakeProjectFactory } from './fake-project-factory.js'

// Records the ambient feedback the manager emits so a test can assert on it.
class RecordingNotifier implements INotificationService {
    public statuses: string[] = []
    Status(message: string): void { this.statuses.push(message) }
    Progress(): void {}
    Report(): void {}
}

// A prompt service whose ConfirmAsk answer is scripted; records that it was asked
// so a test can assert the discard prompt actually fired. Every other ask throws.
class ScriptedPrompts implements IPromptService {
    public asked = 0
    constructor(private readonly confirm: () => Promise<boolean>) {}
    async Ask<R>(request: Ask<R>): Promise<R> {
        if (request instanceof ConfirmAsk) { this.asked++; return (await this.confirm()) as R }
        throw new Error(`unhandled ${request.constructor.name}`)
    }
    Confirm(message: string, confirmLabel?: string): Promise<boolean> { return this.Ask(new ConfirmAsk(message, confirmLabel)) }
    PickFolder(): Promise<string | undefined> { throw new Error('nyi') }
    PickFile(): Promise<string | undefined> { throw new Error('nyi') }
    PromptText(): Promise<string | undefined> { throw new Error('nyi') }
    Choose<T>(): Promise<T | undefined> { throw new Error('nyi') }
}

// Build the service the way the container does — through the constructor — with
// a fake provider that serves fake host services under the manager's keys.
function makeService(opts?: { confirmDiscard?: () => Promise<boolean>; notifier?: INotificationService }) {
    const roots = new Map<string, FakeStorage>()
    const storages: IStorageProviderRegistry = {
        CreateStorage: (folder) => {
            const s = roots.get(folder) ?? new FakeStorage(folder)
            roots.set(folder, s)
            return s
        },
    }
    const factories: IProjectFactoryRegistry = {
        factoryFor: (type) => (type === 'architecture' ? new FakeProjectFactory() : undefined),
        All: () => [],
    }
    const prompts = new ScriptedPrompts(opts?.confirmDiscard ?? (async () => true))
    // Compose is not exercised by these tests, but the ctor now requires the key.
    const packages = { resolve: async () => { throw new Error('no compose in test') } }
    const provider = {
        // Notification is resolved optionally (provider.get) — undefined when the
        // host doesn't register one (a headless batch), the notifier otherwise.
        get: (token: unknown) =>
            token === SolutionManagerService.NotificationServiceKey ? opts?.notifier : undefined,
        getRequired: (token: unknown) => {
            if (token === SolutionManagerService.StorageRegistryKey) return storages
            if (token === SolutionManagerService.ProjectFactoryRegistryKey) return factories
            if (token === SolutionManagerService.PromptServiceKey) return prompts
            if (token === SolutionManagerService.PackageSourceKey) return packages
            throw new Error('unexpected service key')
        },
        has: () => true,
    } as unknown as IServiceProvider
    const svc = new SolutionManagerService(provider)
    return { svc, roots, prompts }
}

test('Save emits a Saved status when a notifier is registered', async () => {
    const notifier = new RecordingNotifier()
    const { svc } = makeService({ notifier })
    await svc.NewSolution('/work/a')
    await svc.Save()
    assert.deepEqual(notifier.statuses, ['Saved.'])
})

test('Save works with no notifier registered', async () => {
    const { svc } = makeService()   // no notifier
    await svc.NewSolution('/work/a')
    await svc.Save()   // must not throw
})

test('New → Save writes solution.json; Open reads it back with members', async () => {
    const { svc, roots } = makeService()
    await svc.NewSolution('/work/sol')
    svc.ActiveSolution!.Name = 'My Solution'
    svc.ActiveSolution!.AddMember('./api', 'architecture')
    await svc.Save()

    const stored = await roots.get('/work/sol')!.ReadText('solution.json')
    assert.match(stored, /todl-solution/)
    assert.match(stored, /\.\/api/)

    await svc.CloseSolution()
    assert.equal(svc.ActiveSolution, undefined)

    await svc.OpenSolution('/work/sol')
    assert.equal(svc.ActiveSolution!.Name, 'My Solution')
    assert.equal(svc.ActiveSolution!.Members.ToArray()[0]!.IsResolved, true)
})

test('Save clears dirty; opening adds to RecentSolutions (move-to-front, deduped)', async () => {
    const { svc } = makeService()
    await svc.NewSolution('/work/sol')
    svc.ActiveSolution!.AddMember('./a', 'architecture')
    assert.equal(svc.ActiveSolution!.IsDirty, true)
    await svc.Save()
    assert.equal(svc.ActiveSolution!.IsDirty, false)
    assert.ok(svc.RecentSolutions.includes('/work/sol'))

    // Save again should not duplicate the recent entry.
    await svc.Save()
    assert.equal(svc.RecentSolutions.filter((p) => p === '/work/sol').length, 1)
})

test('Compose runs members through the injected source and returns diagnostics', async () => {
    const { svc } = makeService()   // fake package source rejects every resolve
    const diagnostics = await svc.Compose([{ model: 'acme.widgets', version: '1.0.0' }])
    assert.equal(diagnostics.length, 1)
    assert.match(diagnostics[0]!.message, /acme\.widgets/)
})

test('a dirty solution asks to discard and blocks replace when the user declines', async () => {
    const { svc, prompts } = makeService({ confirmDiscard: async () => false })   // user says "don't discard"
    await svc.NewSolution('/work/a')
    svc.ActiveSolution!.AddMember('./x', 'architecture')   // now dirty
    const first = svc.ActiveSolution
    await svc.NewSolution('/work/b')   // should be blocked by the declined discard
    assert.equal(prompts.asked, 1)     // the ConfirmAsk fired through IPromptService
    assert.equal(svc.ActiveSolution, first)
})
