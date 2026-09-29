import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime';
import { Solution } from '../solution.js';
import { SolutionMemberStatus } from '../solution-member-status.js';

const storageFor = (): FakeStorage => new FakeStorage();

test('unknown type → UnknownType; sibling still opens → Resolved', async () =>
{
    const sol = new Solution('s');
    sol.AddMember('bad', 'no-such-type');
    sol.AddMember('good', 'ok');
    const okFactory = { openProject: async () => ({}) };
    await sol.OpenMembers(storageFor, (type) => (type === 'ok' ? okFactory : undefined) as never);
    assert.equal(sol.Members.Get(0)!.Status, SolutionMemberStatus.UnknownType);
    assert.equal(sol.Members.Get(1)!.Status, SolutionMemberStatus.Resolved);
});

test('a factory that throws → LoadFailed + Error, and the sibling still opens', async () =>
{
    const sol = new Solution('s');
    sol.AddMember('boom', 'x');
    sol.AddMember('good', 'x');
    let first = true;
    const factory = { openProject: async () => { if (first) { first = false; throw new Error('bad manifest'); } return {}; } };
    await sol.OpenMembers(storageFor, () => factory as never);
    assert.equal(sol.Members.Get(0)!.Status, SolutionMemberStatus.LoadFailed);
    assert.equal(sol.Members.Get(0)!.Error, 'bad manifest');
    assert.equal(sol.Members.Get(1)!.Status, SolutionMemberStatus.Resolved);   // NOT aborted
});
