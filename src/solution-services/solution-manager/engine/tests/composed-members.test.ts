import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeStorage, Signal, type IServiceProvider } from '@pragmatic-tech-ai/todl-runtime';
import { SolutionManagerService } from '../solution-manager-service.js';
import { type IComposedMemberSet } from '../composed-members.js';
import { type SolutionMember } from '../solution-member.js';
import { type IStorageProviderRegistry, type IProjectFactoryRegistry } from '../host-services.js';

class ComposedMembersFixture
{
    public static MakeService(): SolutionManagerService
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
}

class FakeComposedSet implements IComposedMemberSet
{
    public readonly Changed: Signal<void> = new Signal<void>();
    constructor(public Union: readonly SolutionMember[]) { }
    public Members(): readonly SolutionMember[]
    {
        return this.Union;
    }
}

test('default ComposedMembers equals ActiveSolution.Members', async () =>
{
    const svc = ComposedMembersFixture.MakeService();
    assert.deepEqual(svc.ComposedMembers(), []);
    await svc.NewSolution('/work/sol');
    assert.deepEqual(svc.ComposedMembers(), svc.ActiveSolution!.Members.ToArray());
});

test('default ComposedChanged fires when the active solution changes', async () =>
{
    const svc = ComposedMembersFixture.MakeService();
    let fires = 0;
    svc.ComposedChanged.subscribe(() => fires++);
    await svc.NewSolution('/work/sol');
    assert.equal(fires, 1);
    await svc.CloseSolution();
    assert.equal(fires, 2);
});

test('a provider supplies the union and its Changed re-fires ComposedChanged', async () =>
{
    const svc = ComposedMembersFixture.MakeService();
    const union = [{ id: 'a' }, { id: 'b' }] as unknown as SolutionMember[];
    const set = new FakeComposedSet(union);
    svc.SetComposedMemberSet(set);
    assert.deepEqual(svc.ComposedMembers(), union);

    let fires = 0;
    svc.ComposedChanged.subscribe(() => fires++);
    set.Changed.emit();
    assert.equal(fires, 1);

    // Active-solution changes no longer drive ComposedChanged while a provider is set.
    await svc.NewSolution('/work/sol');
    assert.equal(fires, 1);
});

test('clearing the provider reverts to the active solution', async () =>
{
    const svc = ComposedMembersFixture.MakeService();
    await svc.NewSolution('/work/sol');
    const set = new FakeComposedSet([{ id: 'x' }] as unknown as SolutionMember[]);
    svc.SetComposedMemberSet(set);
    svc.SetComposedMemberSet(undefined);
    assert.deepEqual(svc.ComposedMembers(), svc.ActiveSolution!.Members.ToArray());

    let fires = 0;
    svc.ComposedChanged.subscribe(() => fires++);
    set.Changed.emit();
    assert.equal(fires, 0);
    await svc.CloseSolution();
    assert.equal(fires, 1);
});
