import { contextBridge } from "electron";

// SP1: expose an empty namespace so contextIsolation is wired end-to-end.
// SP2 populates `todl.registry` / `todl.config`.
contextBridge.exposeInMainWorld("todl", {});
