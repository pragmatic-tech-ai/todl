import { app, BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";
import { electronApp, is } from "@electron-toolkit/utils";
import { NpmRegistry, TarReader, resolveClosure } from "@pragmatic-tech-ai/todl/package-manager";
import { TokenStore } from "./registry/token-store.js";
import { SettingsStore } from "./registry/settings-store.js";
import { RegistryBridge } from "./registry/registry-bridge.js";
import { RegistryIpc } from "./registry/register-ipc.js";
import { SafeStorageEncryptor } from "./registry/safe-storage-encryptor.js";

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
    createRegistry: (config) => new NpmRegistry(config),
    readPackage: (bytes) => TarReader.readPackage(bytes),
    resolveClosure: (packages, rootDeps) => resolveClosure(packages, rootDeps),
    readFiles: (bytes) => TarReader.read(bytes),
  });
  RegistryIpc.register(ipcMain, bridge);

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
