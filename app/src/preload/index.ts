import { contextBridge, ipcRenderer } from "electron";

/**
 * The single `contextBridge` surface (design §5). Every method is a thin
 * `ipcRenderer.invoke` over a `registry:*` / `config:*` channel — no `ipcRenderer`
 * itself is exposed. The typed shape lives in `renderer/env.d.ts`.
 */
const bridge = {
  registry: {
    list: () => ipcRenderer.invoke("registry:list"),
    versions: (name: string) => ipcRenderer.invoke("registry:versions", name),
    getContent: (ref: unknown) => ipcRenderer.invoke("registry:getContent", ref),
    getPackage: (ref: unknown) => ipcRenderer.invoke("registry:getPackage", ref),
    getMeta: (name: string) => ipcRenderer.invoke("registry:getMeta", name),
    resolveClosure: (rootDeps: string[]) => ipcRenderer.invoke("registry:resolveClosure", rootDeps),
    publishDir: (dir: string) => ipcRenderer.invoke("registry:publishDir", dir),
    compileDir: (dir: string) => ipcRenderer.invoke("registry:compileDir", dir),
    getSources: (ref: unknown) => ipcRenderer.invoke("registry:getSources", ref),
    getPackageContents: (name: string) => ipcRenderer.invoke("registry:getPackageContents", name),
    deleteVersion: (name: string, version: string) => ipcRenderer.invoke("registry:deleteVersion", name, version),
    bumpVersion: (dir: string) => ipcRenderer.invoke("registry:bumpVersion", dir),
  },
  config: {
    get: () => ipcRenderer.invoke("config:get"),
    setToken: (token: string) => ipcRenderer.invoke("config:setToken", token),
    useEnvToken: (name: string) => ipcRenderer.invoke("config:useEnvToken", name),
    listEnvVars: () => ipcRenderer.invoke("config:envVars"),
    setSettings: (partial: unknown) => ipcRenderer.invoke("config:setSettings", partial),
  },
  dialog: {
    pickDirectory: () => ipcRenderer.invoke("dialog:pickDirectory"),
  },
  fs: {
    readDir: (path: string) => ipcRenderer.invoke("fs:readDir", path),
  },
};

contextBridge.exposeInMainWorld("todl", bridge);
