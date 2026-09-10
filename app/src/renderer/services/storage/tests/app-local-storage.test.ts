import { test } from "node:test";
import assert from "node:assert/strict";
import { AppLocalStorage, type FsBridge } from "../app-local-storage.js";
import type { DirEntry } from "../../../../main/registry/register-ipc.js";

// An in-memory fake of the `fs:*` bridge keyed by ABSOLUTE path — asserts that
// AppLocalStorage joins root + relative correctly and delegates each verb. Files
// are strings; directories are tracked as a set so List/exists behave.
class FakeFsBridge implements FsBridge {
  readonly files = new Map<string, string>();
  readonly dirs = new Set<string>();
  readonly opened: string[] = [];

  async readText(path: string): Promise<string> {
    const v = this.files.get(path);
    if (v === undefined) throw new Error(`ENOENT ${path}`);
    return v;
  }
  async readBytes(path: string): Promise<Uint8Array> {
    return new TextEncoder().encode(await this.readText(path));
  }
  async writeText(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }
  async writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    this.files.set(path, new TextDecoder().decode(bytes));
  }
  async exists(path: string): Promise<boolean> {
    if (this.files.has(path) || this.dirs.has(path)) return true;
    // A directory exists implicitly if any file/dir lives under it.
    const prefix = path.endsWith("/") ? path : path + "/";
    for (const f of this.files.keys()) if (f.startsWith(prefix)) return true;
    for (const d of this.dirs) if (d.startsWith(prefix)) return true;
    return false;
  }
  async delete(path: string): Promise<void> {
    this.files.delete(path);
    this.dirs.delete(path);
  }
  async mkdir(path: string): Promise<void> {
    this.dirs.add(path);
  }
  async rename(from: string, to: string): Promise<void> {
    const v = this.files.get(from);
    if (v !== undefined) {
      this.files.set(to, v);
      this.files.delete(from);
    }
  }
  async list(path: string): Promise<DirEntry[]> {
    const prefix = path.endsWith("/") ? path : path + "/";
    const out: DirEntry[] = [];
    for (const f of this.files.keys()) {
      if (f.startsWith(prefix)) {
        const rest = f.slice(prefix.length);
        if (!rest.includes("/")) out.push({ name: rest, path: f, isDirectory: false });
      }
    }
    return out;
  }
  async openExternal(path: string): Promise<void> {
    this.opened.push(path);
  }
}

test("joins root + relative path (POSIX root) and round-trips text", async () => {
  const fs = new FakeFsBridge();
  const s = new AppLocalStorage("/work/sol", fs);
  await s.WriteText("a/b.txt", "hi");
  assert.equal(fs.files.get("/work/sol/a/b.txt"), "hi");
  assert.equal(await s.ReadText("a/b.txt"), "hi");
  // WriteText mkdir'd the parent
  assert.ok(fs.dirs.has("/work/sol/a"));
});

test("abs('') resolves to the root itself", async () => {
  const fs = new FakeFsBridge();
  const s = new AppLocalStorage("/work/sol", fs);
  await s.CreateDirectory("");
  assert.ok(fs.dirs.has("/work/sol"));
});

test("List on a missing directory returns empty, not a throw", async () => {
  const fs = new FakeFsBridge();
  const s = new AppLocalStorage("/work/sol", fs);
  assert.deepEqual(await s.List("nope"), []);
});

test("List maps DirEntry → StorageEntry", async () => {
  const fs = new FakeFsBridge();
  const s = new AppLocalStorage("/work/sol", fs);
  await s.WriteText("x.todl", "1");
  await s.WriteText("y.todl", "2");
  const entries = await s.List("");
  assert.deepEqual(
    entries.map((e) => ({ Name: e.Name, IsDirectory: e.IsDirectory })).sort((a, b) => a.Name.localeCompare(b.Name)),
    [
      { Name: "x.todl", IsDirectory: false },
      { Name: "y.todl", IsDirectory: false },
    ],
  );
});

test("ResolveOsPath joins; OpenExternal delegates the absolute path", async () => {
  const fs = new FakeFsBridge();
  const s = new AppLocalStorage("/work/sol", fs);
  assert.equal(s.ResolveOsPath("a/b"), "/work/sol/a/b");
  await s.OpenExternal("a/b");
  assert.deepEqual(fs.opened, ["/work/sol/a/b"]);
});

test("Windows-rooted storage joins with backslashes", async () => {
  const fs = new FakeFsBridge();
  const s = new AppLocalStorage("C:\\work\\sol", fs);
  await s.WriteText("a/b.txt", "hi");
  assert.equal(fs.files.get("C:\\work\\sol\\a\\b.txt"), "hi");
});
