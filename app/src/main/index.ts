import { app, BrowserWindow, ipcMain, dialog } from "electron";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { electronApp, is } from "@electron-toolkit/utils";
import { PackageManager, PackageCompiler } from "@pragmatic-tech-ai/todl/package-manager";
import { TokenStore } from "./registry/token-store.js";
import { SettingsStore } from "./registry/settings-store.js";
import { RegistryBridge } from "./registry/registry-bridge.js";
import { RegistryIpc } from "./registry/register-ipc.js";
import { FsIpc } from "./fs/fs-ipc.js";
import { SafeStorageEncryptor } from "./registry/safe-storage-encryptor.js";
import { Updater } from "./updater.js";

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    show: false,
    backgroundColor: "#1C1B1F", // Mural dark @Surface — no white flash on load
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  window.on("ready-to-show", () => window.show());

  if (is.dev && process.env["ELECTRON_RENDERER_URL"] !== undefined) {
    void window.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

void app.whenReady().then(() => {
  electronApp.setAppUserModelId("com.pragmatic-tech-ai.todl");

  const userData = app.getPath("userData");
  const bridge = new RegistryBridge({
    tokenStore: new TokenStore(userData, new SafeStorageEncryptor()),
    settingsStore: new SettingsStore(userData),
    createManager: (config) => new PackageManager(config),
    createCompiler: () => new PackageCompiler(),
    env: process.env,
  });
  RegistryIpc.register(
    ipcMain,
    bridge,
    async () => {
      const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
      return result.canceled || result.filePaths.length === 0 ? "" : result.filePaths[0]!;
    },
    async (dir) => {
      const entries = await readdir(dir, { withFileTypes: true });
      return entries
        .map((e) => ({ name: e.name, path: join(dir, e.name), isDirectory: e.isDirectory() }))
        .sort((a, b) => (a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1));
    },
  );
  FsIpc.register(ipcMain);

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  Updater.init();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
