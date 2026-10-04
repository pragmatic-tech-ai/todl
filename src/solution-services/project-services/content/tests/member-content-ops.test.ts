import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime';
import { SolutionMember } from '../../../solution-manager/engine/solution-member.js';
import { type IContentLifecycleGuard } from '../content-lifecycle.js';
import { MemberContentOps, RenameError } from '../member-content-ops.js';

class RecordingGuard implements IContentLifecycleGuard
{
    public readonly Calls: string[] = [];
    constructor(private readonly allow = true) {}
    public async CanRemove(_m: SolutionMember, paths: readonly string[]): Promise<boolean>
    {
        this.Calls.push('can:' + paths.join(','));
        return this.allow;
    }
    public OnMoved(_m: SolutionMember, from: string, to: string): void { this.Calls.push(`moved:${from}>${to}`); }
    public OnRemoved(_m: SolutionMember, paths: readonly string[]): void { this.Calls.push('removed:' + paths.join(',')); }
}

class Fixture
{
    public static Setup(allow = true, withGuard = true)
    {
        const storage = new FakeStorage();
        const member = new SolutionMember({ path: 'p', type: 't' } as never);
        member.Storage = storage;
        const guard = new RecordingGuard(allow);
        return { storage, guard, ops: new MemberContentOps(member, withGuard ? guard : undefined) };
    }
}

test('Rename collision returns Collision and leaves disk untouched', async () =>
{
    const { storage, guard, ops } = Fixture.Setup();
    await storage.WriteText('a.txt', 'a'); await storage.WriteText('b.txt', 'b');
    assert.deepEqual(await ops.Rename('a.txt', 'b.txt'), { ok: false, error: RenameError.Collision });
    assert.equal(await storage.ReadText('a.txt'), 'a');
    assert.deepEqual(guard.Calls, []);
});

test('Rename validates empty and invalid names', async () =>
{
    const { storage, ops } = Fixture.Setup();
    await storage.WriteText('a.txt', 'a');
    assert.deepEqual(await ops.Rename('a.txt', '  '), { ok: false, error: RenameError.Empty });
    assert.deepEqual(await ops.Rename('a.txt', 'x/y'), { ok: false, error: RenameError.Invalid });
});

test('Rename ok renames and notifies OnMoved', async () =>
{
    const { storage, guard, ops } = Fixture.Setup();
    await storage.CreateDirectory('d');
    await storage.WriteText('d/a.txt', 'a');
    assert.deepEqual(await ops.Rename('d/a.txt', 'c.txt'), { ok: true, to: 'd/c.txt' });
    assert.equal(await storage.Exists('d/a.txt'), false);
    assert.equal(await storage.ReadText('d/c.txt'), 'a');
    assert.deepEqual(guard.Calls, ['moved:d/a.txt>d/c.txt']);
});

test('Delete veto skips disk delete', async () =>
{
    const { storage, guard, ops } = Fixture.Setup(false);
    await storage.WriteText('a.txt', 'a');
    await ops.Delete(['a.txt']);
    assert.equal(await storage.Exists('a.txt'), true);
    assert.deepEqual(guard.Calls, ['can:a.txt']);
});

test('Delete accepted deletes roots only and notifies OnRemoved', async () =>
{
    const { storage, guard, ops } = Fixture.Setup(true);
    await storage.CreateDirectory('d');
    await storage.WriteText('d/a.txt', 'a'); await storage.WriteText('b.txt', 'b');
    await ops.Delete(['d', 'd/a.txt', 'b.txt', '']);
    assert.equal(await storage.Exists('d'), false);
    assert.equal(await storage.Exists('b.txt'), false);
    assert.deepEqual(guard.Calls, ['can:d,b.txt', 'removed:d,b.txt']);
});

test('NewFolder honors the passed name and dedupes', async () =>
{
    const { storage, ops } = Fixture.Setup();
    assert.equal(await ops.NewFolder('', 'Docs'), 'Docs');
    assert.equal(await ops.NewFolder('', 'Docs'), 'Docs-2');
    assert.equal(await ops.NewFolder('', undefined), 'New Folder');
    assert.equal(await storage.Exists('Docs-2'), true);
});

test('NewFile writes content at a unique path', async () =>
{
    const { storage, ops } = Fixture.Setup();
    assert.equal(await ops.NewFile('', 'n.txt', 'one'), 'n.txt');
    assert.equal(await ops.NewFile('', 'n.txt', 'two'), 'n-2.txt');
    assert.equal(await storage.ReadText('n-2.txt'), 'two');
});

test('ImportBytes writes under unique names', async () =>
{
    const { storage, ops } = Fixture.Setup();
    await storage.WriteText('f.bin', 'x');
    const added = await ops.ImportBytes('', [{ name: 'f.bin', bytes: new Uint8Array([1, 2]) }]);
    assert.deepEqual(added, ['f-2.bin']);
});

test('Move skips existing destination, reports skipped, notifies OnMoved', async () =>
{
    const { storage, guard, ops } = Fixture.Setup();
    await storage.CreateDirectory('dst');
    await storage.WriteText('a.txt', 'a'); await storage.WriteText('b.txt', 'b'); await storage.WriteText('dst/b.txt', 'old');
    const r = await ops.Move(['a.txt', 'b.txt'], 'dst');
    assert.deepEqual(r.moved, [{ from: 'a.txt', to: 'dst/a.txt' }]);
    assert.deepEqual(r.skipped, ['b.txt']);
    assert.equal(await storage.ReadText('dst/b.txt'), 'old');
    assert.deepEqual(guard.Calls, ['moved:a.txt>dst/a.txt']);
});

test('Move rejects a folder into itself', async () =>
{
    const { storage, ops } = Fixture.Setup();
    await storage.CreateDirectory('d'); await storage.CreateDirectory('d/e');
    const r = await ops.Move(['d'], 'd/e');
    assert.deepEqual(r.moved, []);
    assert.deepEqual(r.skipped, ['d']);
});

test('Rename of a folder moves its subtree', async () =>
{
    const { storage, ops } = Fixture.Setup();
    await storage.CreateDirectory('d');
    await storage.WriteText('d/a.txt', 'a');
    assert.deepEqual(await ops.Rename('d', 'e'), { ok: true, to: 'e' });
    assert.equal(await storage.Exists('d'), false);
    assert.equal(await storage.ReadText('e/a.txt'), 'a');
});

test('Rename to the same name is a no-op without guard call', async () =>
{
    const { storage, guard, ops } = Fixture.Setup();
    await storage.WriteText('a.txt', 'a');
    assert.deepEqual(await ops.Rename('a.txt', 'a.txt'), { ok: true, to: 'a.txt' });
    assert.deepEqual(guard.Calls, []);
});

test('Rename rejects dot names', async () =>
{
    const { storage, ops } = Fixture.Setup();
    await storage.WriteText('a.txt', 'a');
    assert.deepEqual(await ops.Rename('a.txt', '..'), { ok: false, error: RenameError.Invalid });
    assert.deepEqual(await ops.Rename('a.txt', '.'), { ok: false, error: RenameError.Invalid });
});

test('NewFile, NewFolder and ImportBytes reject escaping names before writing', async () =>
{
    const { storage, ops } = Fixture.Setup();
    await assert.rejects(() => ops.NewFile('d', '..', 'x'));
    await assert.rejects(() => ops.NewFile('', 'a\\b', 'x'));
    await assert.rejects(() => ops.NewFolder('', 'a/b'));
    await assert.rejects(() => ops.NewFolder('', '..'));
    await assert.rejects(() => ops.ImportBytes('', [{ name: 'ok.bin', bytes: new Uint8Array([1]) }, { name: '../x', bytes: new Uint8Array([1]) }]));
    assert.equal(await storage.Exists('ok.bin'), false);
});

test('Delete without a guard succeeds', async () =>
{
    const { storage, ops } = Fixture.Setup(true, false);
    await storage.WriteText('a.txt', 'a');
    await ops.Delete(['a.txt']);
    assert.equal(await storage.Exists('a.txt'), false);
});
