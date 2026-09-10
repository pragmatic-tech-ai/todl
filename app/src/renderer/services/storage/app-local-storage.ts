import type { ILocalFileAccess, IStorage, StorageEntry } from "@pragmatic-tech-ai/todl-runtime";
import type { DirEntry } from "../../../main/registry/register-ipc.js";

// The subset of the `window.todl` bridge this storage needs. Injected (not read
// off `window`) so `AppLocalStorage` is node-testable against a fake bridge —
// the same reason `RegistryClient` keeps its mural imports type-only.
export interface FsBridge {
  readText(path: string): Promise<string>;
  readBytes(path: string): Promise<Uint8Array>;
  writeText(path: string, content: string): Promise<void>;
  writeBytes(path: string, bytes: Uint8Array): Promise<void>;
  exists(path: string): Promise<boolean>;
  delete(path: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  list(path: string): Promise<DirEntry[]>;
  openExternal(path: string): Promise<void>;
}

// AppLocalStorage — the app's one storage backend today. Rooted at an absolute
// OS folder; joins root + project-relative path → absolute and delegates every
// call to the `fs:*` IPC bridge (main-side node:fs). Also implements
// ILocalFileAccess, since a disk-backed store can resolve real OS paths and open
// attachments in the OS default app. Mirrors Plexus's LocalFileStorage (which
// delegates to FileSystemService) — same abs()/ensureParent() path logic, just
// a different backend seam.
export class AppLocalStorage implements IStorage, ILocalFileAccess {
  constructor(
    private readonly root: string,
    private readonly fs: FsBridge,
  ) {}

  get Root(): string {
    return this.root;
  }

  ReadText(path: string): Promise<string> {
    return this.fs.readText(this.abs(path));
  }

  ReadBytes(path: string): Promise<Uint8Array> {
    return this.fs.readBytes(this.abs(path));
  }

  async WriteText(path: string, content: string): Promise<void> {
    await this.ensureParent(path);
    return this.fs.writeText(this.abs(path), content);
  }

  async WriteBytes(path: string, bytes: Uint8Array): Promise<void> {
    await this.ensureParent(path);
    return this.fs.writeBytes(this.abs(path), bytes);
  }

  Exists(path: string): Promise<boolean> {
    return this.fs.exists(this.abs(path));
  }

  Delete(path: string): Promise<void> {
    return this.fs.delete(this.abs(path));
  }

  CreateDirectory(path: string): Promise<void> {
    return this.fs.mkdir(this.abs(path));
  }

  Rename(from: string, to: string): Promise<void> {
    return this.fs.rename(this.abs(from), this.abs(to));
  }

  async List(path: string): Promise<readonly StorageEntry[]> {
    const abs = this.abs(path);
    // A non-existent directory lists as empty — matching the in-memory
    // FakeStorage double and the normal "not created yet" state. Any other
    // failure is genuine and rethrows.
    if (!(await this.fs.exists(abs))) return [];
    const entries = await this.fs.list(abs);
    return entries.map((e) => ({ Name: e.name, IsDirectory: e.isDirectory }));
  }

  ResolveOsPath(path: string): string {
    return this.abs(path);
  }

  OpenExternal(path: string): Promise<void> {
    return this.fs.openExternal(this.abs(path));
  }

  // Ensure a file's parent directory exists before writing it (node's writeFile
  // ENOENTs on a missing parent, whereas FakeStorage lets a nested write
  // succeed). A top-level write (no parent segment) relies on the root existing.
  private async ensureParent(path: string): Promise<void> {
    const segments = path.split(/[\\/]/).filter((s) => s.length > 0);
    segments.pop(); // drop the file name; what remains is the parent directory
    if (segments.length > 0) await this.fs.mkdir(this.abs(segments.join("/")));
  }

  // Project-relative → absolute OS path. '' (the root) resolves to the root
  // itself; otherwise each relative segment is appended with the root's
  // separator. Leading/trailing slashes in the relative path are tolerated.
  private abs(relative: string): string {
    const sep = this.root.includes("\\") && !this.root.includes("/") ? "\\" : "/";
    const segments = relative.split(/[\\/]/).filter((s) => s.length > 0);
    if (segments.length === 0) return this.root;
    const base = this.root.endsWith(sep) ? this.root.slice(0, -sep.length) : this.root;
    return base + sep + segments.join(sep);
  }
}
