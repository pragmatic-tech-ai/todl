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
    resolvePackage: (ref: unknown) => ipcRenderer.invoke("registry:resolvePackage", ref),
    packageVersions: (model: string) => ipcRenderer.invoke("registry:packageVersions", model),
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
    readText: (path: string) => ipcRenderer.invoke("fs:readText", path),
    readBytes: (path: string) => ipcRenderer.invoke("fs:readBytes", path),
    writeText: (path: string, content: string) => ipcRenderer.invoke("fs:writeText", path, content),
    writeBytes: (path: string, bytes: Uint8Array) => ipcRenderer.invoke("fs:writeBytes", path, bytes),
    exists: (path: string) => ipcRenderer.invoke("fs:exists", path),
    delete: (path: string) => ipcRenderer.invoke("fs:delete", path),
    mkdir: (path: string) => ipcRenderer.invoke("fs:mkdir", path),
    rename: (from: string, to: string) => ipcRenderer.invoke("fs:rename", from, to),
    list: (path: string) => ipcRenderer.invoke("fs:list", path),
    openExternal: (path: string) => ipcRenderer.invoke("fs:openExternal", path),
  },
};

contextBridge.exposeInMainWorld("todl", bridge);
