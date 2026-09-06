/**
 * Map the `registry:*` / `config:*` / `dialog:*` IPC channels onto `RegistryBridge`
 * methods + a native directory picker (design §5). Channel names MUST match the
 * preload surface (`preload/index.ts`).
 */
import type { IpcMain } from "electron";
import type { RegistryBridge } from "./registry-bridge.js";

export class RegistryIpc {
  static register(ipcMain: IpcMain, bridge: RegistryBridge, pickDirectory: () => Promise<string>): void {
    ipcMain.handle("registry:list", () => bridge.list());
    ipcMain.handle("registry:versions", (_e, name: string) => bridge.versions(name));
    ipcMain.handle("registry:getContent", (_e, ref) => bridge.getContent(ref));
    ipcMain.handle("registry:getPackage", (_e, ref) => bridge.getPackage(ref));
    ipcMain.handle("registry:getMeta", (_e, name: string) => bridge.getMeta(name));
    ipcMain.handle("registry:resolveClosure", (_e, rootDeps: string[]) => bridge.resolveClosure(rootDeps));
    ipcMain.handle("registry:publishDir", (_e, dir: string) => bridge.publishDir(dir));
    ipcMain.handle("registry:getSources", (_e, ref) => bridge.getSources(ref));
    ipcMain.handle("config:get", () => bridge.getConfig());
    ipcMain.handle("config:setToken", (_e, token: string) => bridge.setStoredToken(token));
    ipcMain.handle("config:useEnvToken", (_e, name: string) => bridge.useEnvToken(name));
    ipcMain.handle("config:envVars", () => bridge.listEnvVars());
    ipcMain.handle("config:setSettings", (_e, partial) => bridge.setSettings(partial));
    ipcMain.handle("dialog:pickDirectory", () => pickDirectory());
  }
}
