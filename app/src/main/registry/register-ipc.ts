/**
 * Map the `registry:*` / `config:*` / `dialog:*` IPC channels onto `RegistryBridge`
 * methods + a native directory picker (design §5). Channel names MUST match the
 * preload surface (`preload/index.ts`).
 */
import type { IpcMain } from "electron";
import type { RegistryBridge } from "./registry-bridge.js";

// One entry in a directory listing (design: the compiler side-pane folder tree).
// `path` is the absolute child path (joined main-side) so the renderer never
// composes paths; `isDirectory` drives lazy branch vs. leaf.
export interface DirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

export class RegistryIpc {
  static register(
    ipcMain: IpcMain,
    bridge: RegistryBridge,
    pickDirectory: () => Promise<string>,
    readDir: (path: string) => Promise<DirEntry[]>,
  ): void {
    ipcMain.handle("registry:list", () => bridge.list());
    ipcMain.handle("registry:versions", (_e, name: string) => bridge.versions(name));
    ipcMain.handle("registry:getContent", (_e, ref) => bridge.getContent(ref));
    ipcMain.handle("registry:getPackage", (_e, ref) => bridge.getPackage(ref));
    ipcMain.handle("registry:getMeta", (_e, name: string) => bridge.getMeta(name));
    ipcMain.handle("registry:resolveClosure", (_e, rootDeps: string[]) => bridge.resolveClosure(rootDeps));
    ipcMain.handle("registry:publishDir", (_e, dir: string) => bridge.publishDir(dir));
    ipcMain.handle("registry:compileDir", (_e, dir: string) => bridge.compileDir(dir));
    ipcMain.handle("registry:resolvePackage", (_e, ref) => bridge.resolvePackage(ref));
    ipcMain.handle("registry:packageVersions", (_e, model: string) => bridge.packageVersions(model));
    ipcMain.handle("registry:getSources", (_e, ref) => bridge.getSources(ref));
    ipcMain.handle("registry:getPackageContents", (_e, name: string) => bridge.getPackageContents(name));
    ipcMain.handle("registry:deleteVersion", (_e, name: string, version: string) => bridge.deleteVersion(name, version));
    ipcMain.handle("registry:bumpVersion", (_e, dir: string) => bridge.bumpVersion(dir));
    ipcMain.handle("config:get", () => bridge.getConfig());
    ipcMain.handle("config:setToken", (_e, token: string) => bridge.setStoredToken(token));
    ipcMain.handle("config:useEnvToken", (_e, name: string) => bridge.useEnvToken(name));
    ipcMain.handle("config:envVars", () => bridge.listEnvVars());
    ipcMain.handle("config:setSettings", (_e, partial) => bridge.setSettings(partial));
    ipcMain.handle("dialog:pickDirectory", () => pickDirectory());
    ipcMain.handle("fs:readDir", (_e, path: string) => readDir(path));
  }
}
