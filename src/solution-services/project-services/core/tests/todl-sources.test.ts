import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime';
import { TodlProjectSourceFiles } from '../todl-sources.js';

// A producer project's compiled output (an npm-package build) re-emits a copy of
// every `.todl` under build/npm-package/src/. Dependencies (node_modules) and VCS
// (.git) likewise hold non-source `.todl`. Walking them as source re-declares every
// node ("node already exists") and fails the analysis/compile, so Collect must skip
// all of them at the project root — not just dist/.
test('Collect excludes build-output, dependency, and vcs directories', async () =>
{
    const storage = new FakeStorage('/proj');
    await storage.WriteText('concepts/actor.todl', 'namespace a { }');
    await storage.WriteText('build/npm-package/src/concepts/actor.todl', 'namespace a { }');
    await storage.WriteText('dist/concepts/actor.todl', 'namespace a { }');
    await storage.WriteText('node_modules/dep/x.todl', 'namespace b { }');
    await storage.WriteText('.git/stash.todl', 'namespace c { }');

    const uris = (await TodlProjectSourceFiles.Collect(storage)).map((f) => f.uri).sort();

    assert.deepEqual(uris, ['concepts/actor.todl']);
});
