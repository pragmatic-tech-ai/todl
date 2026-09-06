/**
 * Auto-update wiring (mirrors Plexus). Guarded: only a packaged Linux AppImage
 * auto-updates (Windows ships an MSI = manual updates). Inert until a GitHub
 * releases repo + CI publish artifacts (electron-builder.yml `publish`). `init`
 * lazy-imports electron-updater so the guard stays unit-testable without it.
 */
export class Updater {
  static shouldAutoUpdate(platform: string, env: Record<string, string | undefined>): boolean {
    return platform === "linux" && env["APPIMAGE"] !== undefined;
  }

  static init(): void {
    if (!Updater.shouldAutoUpdate(process.platform, process.env)) return;
    // Lazy import: only loaded in the one environment that auto-updates.
    void import("electron-updater").then(({ autoUpdater }) => {
      void autoUpdater.checkForUpdatesAndNotify();
    });
  }
}
