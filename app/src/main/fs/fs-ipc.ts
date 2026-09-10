/**
 * Map the `fs:*` IPC channels onto Node's file system (design §5 storage seam).
 * Channel names MUST match the preload surface (`preload/index.ts`) and the
 * renderer `AppLocalStorage` client. Every path arriving here is ALREADY an
 * absolute OS path — the renderer's rooted `AppLocalStorage` joins its project
 * root to the project-relative path before invoking, so main never composes
 * paths (mirrors the existing `fs:readDir` contract).
 */
import { shell, type IpcMain } from "electron";
import { readFile, writeFile, rm, mkdir, rename, readdir, access } from "node:fs/promises";
import { join } from "node:path";
import type { DirEntry } from "../registry/register-ipc.js";

export class FsIpc {
  static register(ipcMain: IpcMain): void {
    ipcMain.handle("fs:readText", (_e, path: string) => FsIpc.readText(path));
    ipcMain.handle("fs:readBytes", (_e, path: string) => FsIpc.readBytes(path));
    ipcMain.handle("fs:writeText", (_e, path: string, content: string) => FsIpc.writeText(path, content));
    ipcMain.handle("fs:writeBytes", (_e, path: string, bytes: Uint8Array) => FsIpc.writeBytes(path, bytes));
    ipcMain.handle("fs:exists", (_e, path: string) => FsIpc.exists(path));
    ipcMain.handle("fs:delete", (_e, path: string) => FsIpc.delete(path));
    ipcMain.handle("fs:mkdir", (_e, path: string) => FsIpc.mkdir(path));
    ipcMain.handle("fs:rename", (_e, from: string, to: string) => FsIpc.rename(from, to));
    ipcMain.handle("fs:list", (_e, path: string) => FsIpc.list(path));
    ipcMain.handle("fs:openExternal", (_e, path: string) => FsIpc.openExternal(path));
  }

  // Reveal/open a resource in the OS default application (ILocalFileAccess).
  private static async openExternal(path: string): Promise<void> {
    await shell.openPath(path);
  }

  private static async readText(path: string): Promise<string> {
    return readFile(path, "utf8");
  }

  // Buffer is a Uint8Array subclass; IPC structured-clone preserves it.
  private static async readBytes(path: string): Promise<Uint8Array> {
    return readFile(path);
  }

  private static async writeText(path: string, content: string): Promise<void> {
    await writeFile(path, content, "utf8");
  }

  private static async writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    await writeFile(path, Buffer.from(bytes));
  }

  private static async exists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  private static async delete(path: string): Promise<void> {
    await rm(path, { recursive: true, force: true });
  }

  // Recursive + idempotent (mirrors IStorage.CreateDirectory semantics).
  private static async mkdir(path: string): Promise<void> {
    await mkdir(path, { recursive: true });
  }

  private static async rename(from: string, to: string): Promise<void> {
    await rename(from, to);
  }

  // One directory, non-recursive; children carry absolute paths joined here so
  // the renderer never composes paths. Unordered — the renderer sorts through
  // `compareStorageEntries`.
  private static async list(path: string): Promise<DirEntry[]> {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.map((e) => ({ name: e.name, path: join(path, e.name), isDirectory: e.isDirectory() }));
  }
}
