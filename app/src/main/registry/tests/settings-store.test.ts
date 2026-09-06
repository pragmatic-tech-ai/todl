import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SettingsStore, TokenSource } from "../settings-store.js";

const freshDir = () => mkdtempSync(join(tmpdir(), "todl-settings-"));

test("get returns the SP2 defaults when nothing is stored", () => {
  assert.deepEqual(new SettingsStore(freshDir()).get(), {
    registry: "https://npm.pkg.github.com",
    scope: "@pragmatic-tech-ai",
    org: "pragmatic-tech-ai",
    githubApi: "https://api.github.com",
    tokenSource: "stored",
    tokenEnvVar: "",
  });
});

test("update persists tokenSource + tokenEnvVar", () => {
  const dir = freshDir();
  new SettingsStore(dir).update({ tokenSource: TokenSource.Env, tokenEnvVar: "GH_PAT" });
  const s = new SettingsStore(dir).get();
  assert.equal(s.tokenSource, "env");
  assert.equal(s.tokenEnvVar, "GH_PAT");
});

test("update merges a partial and persists across instances", () => {
  const dir = freshDir();
  new SettingsStore(dir).update({ scope: "@acme", org: "acme" });
  const reloaded = new SettingsStore(dir).get();
  assert.equal(reloaded.scope, "@acme");
  assert.equal(reloaded.org, "acme");
  assert.equal(reloaded.registry, "https://npm.pkg.github.com"); // untouched default kept
});
