import test from 'node:test'
import assert from 'node:assert/strict'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { UniqueName } from '../unique-name.js'

test('UniqueName.For returns the name unchanged when free', async () =>
{
    const storage = new FakeStorage('/p')
    assert.equal(await UniqueName.For(storage, 'a.ts'), 'a.ts')
})

test('UniqueName.For suffixes stem-N.ext (N starts at 2) when taken', async () =>
{
    const storage = new FakeStorage('/p')
    await storage.WriteText('a.ts', 'x')
    assert.equal(await UniqueName.For(storage, 'a.ts'), 'a-2.ts')
    await storage.WriteText('a-2.ts', 'x')
    assert.equal(await UniqueName.For(storage, 'a.ts'), 'a-3.ts')
})

test('UniqueName.For keeps dotfiles whole and handles extensionless names', async () =>
{
    const storage = new FakeStorage('/p')
    await storage.WriteText('.gitignore', 'x')
    await storage.WriteText('New Folder', 'x')
    assert.equal(await UniqueName.For(storage, '.gitignore'), '.gitignore-2')
    assert.equal(await UniqueName.For(storage, 'New Folder'), 'New Folder-2')
})
