import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeStorage, FileChangeKind } from "@pragmatic-tech-ai/todl-runtime";
import { MemberContentWatcher } from "../member-content-watcher.js";

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5));

test("fires when a .todl file is added on disk under the member (#16)", async () => {
    const s = new FakeStorage();
    await s.WriteText("a.todl", "");
    let fires = 0;
    const w = new MemberContentWatcher(s, () => { fires += 1; }, { settleMs: 0 });
    await w.Start();
    assert.equal(fires, 0, "baseline enumeration must not fire");

    await s.WriteText("b.todl", "");
    s.EmitFileChange("b.todl", FileChangeKind.Added, false);
    await tick();
    assert.equal(fires, 1, "an on-disk .todl add should fire one invalidation");
    w.dispose();
});

test("fires when a .todl file is removed, and ignores non-.todl changes (#16)", async () => {
    const s = new FakeStorage();
    await s.WriteText("a.todl", "");
    await s.WriteText("notes.md", "");
    let fires = 0;
    const w = new MemberContentWatcher(s, () => { fires += 1; }, { settleMs: 0 });
    await w.Start();

    s.EmitFileChange("notes.md", FileChangeKind.Added, false);
    await tick();
    assert.equal(fires, 0, "a non-.todl change must not fire");

    await s.Delete("a.todl");
    s.EmitFileChange("a.todl", FileChangeKind.Removed, false);
    await tick();
    assert.equal(fires, 1, "an on-disk .todl remove should fire one invalidation");
    w.dispose();
});

test("stops firing after dispose (#16)", async () => {
    const s = new FakeStorage();
    let fires = 0;
    const w = new MemberContentWatcher(s, () => { fires += 1; }, { settleMs: 0 });
    await w.Start();
    w.dispose();
    await s.WriteText("late.todl", "");
    s.EmitFileChange("late.todl", FileChangeKind.Added, false);
    await tick();
    assert.equal(fires, 0);
});

test("fires for a .todl added in a NESTED folder (recursion, the depth:0-watch gap) (#16)", async () => {
    const s = new FakeStorage();
    await s.WriteText("sub/a.todl", "");
    let fires = 0;
    const w = new MemberContentWatcher(s, () => { fires += 1; }, { settleMs: 0 });
    await w.Start();
    assert.equal(fires, 0);

    await s.WriteText("sub/c.todl", "");
    s.EmitFileChange("sub/c.todl", FileChangeKind.Added, false);
    await tick();
    assert.equal(fires, 1, "a .todl added under a subfolder should be caught");
    w.dispose();
});
