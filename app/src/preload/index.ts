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
    resolveClosure: (rootDeps: string[]) => ipcRenderer.invoke("registry:resolveClosure", rootDeps),
    publishDir: (dir: string) => ipcRenderer.invoke("registry:publishDir", dir),
    getSources: (ref: unknown) => ipcRenderer.invoke("registry:getSources", ref),
  },
  config: {
    get: () => ipcRenderer.invoke("config:get"),
    setToken: (token: string) => ipcRenderer.invoke("config:setToken", token),
    setSettings: (partial: unknown) => ipcRenderer.invoke("config:setSettings", partial),
  },
};

contextBridge.exposeInMainWorld("todl", bridge);
