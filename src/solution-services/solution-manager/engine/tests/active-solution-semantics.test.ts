import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeStorage, type IServiceProvider } from '@pragmatic-tech-ai/todl-runtime';
import { SolutionManagerService } from '../solution-manager-service.js';
import { type IStorageProviderRegistry, type IProjectFactoryRegistry } from '../host-services.js';

// A minimal SolutionManagerService with just the seams NewSolution/CloseSolution touch
// (mirrors makeService in solution-manager-service.test.ts, trimmed to this concern).
function makeService(): SolutionManagerService
{
    const roots = new Map<string, FakeStorage>();
    const storages: IStorageProviderRegistry = {
        CreateStorage: (folder) =>
        {
            const s = roots.get(folder) ?? new FakeStorage(folder);
            roots.set(folder, s);
            return s;
        },
    };
    const factories: IProjectFactoryRegistry = { factoryFor: () => undefined, All: () => [] };
    const prompts = { ConfirmAsk: async () => true } as unknown;
    const packages = { resolve: async () => { throw new Error('no compose in test'); } };
    const provider = {
        get: () => undefined,
        getRequired: (token: unknown) =>
        {
            if (token === SolutionManagerService.StorageRegistryKey) return storages;
            if (token === SolutionManagerService.ProjectFactoryRegistryKey) return factories;
            if (token === SolutionManagerService.PromptServiceKey) return prompts;
            if (token === SolutionManagerService.PackageSourceKey) return packages;
            throw new Error('unexpected service key');
        },
        has: () => true,
    } as unknown as IServiceProvider;
    return new SolutionManagerService(provider);
}

test('ActiveSolution publishes PropertyChanged on open and on close', async () =>
{
    const svc = makeService();
    let raises = 0;
    svc.PropertyChanged('ActiveSolution').subscribe(() => raises++);

    await svc.NewSolution('/work/sol');
    assert.ok(svc.ActiveSolution !== undefined);
    assert.equal(raises, 1);                         // opening published new solution

    await svc.CloseSolution();
    assert.equal(svc.ActiveSolution, undefined);
    assert.equal(raises, 2);                         // closing published undefined
});
