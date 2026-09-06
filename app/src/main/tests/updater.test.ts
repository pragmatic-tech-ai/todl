import { test } from "node:test";
import assert from "node:assert/strict";
import { Updater } from "../updater.js";

test("auto-update runs only for a packaged Linux AppImage", () => {
  assert.equal(Updater.shouldAutoUpdate("linux", { APPIMAGE: "/x.AppImage" }), true);
  assert.equal(Updater.shouldAutoUpdate("linux", {}), false); // not packaged
  assert.equal(Updater.shouldAutoUpdate("win32", { APPIMAGE: "/x" }), false); // MSI = manual
});
