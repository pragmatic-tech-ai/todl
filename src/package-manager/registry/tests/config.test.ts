import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveRegistryConfig } from "../config.js";

function projectDir(npmrc?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "todl-cfg-"));
  if (npmrc !== undefined) writeFileSync(join(dir, ".npmrc"), npmrc);
  return dir;
}

test("defaults apply when nothing is configured", () => {
  const config = resolveRegistryConfig(projectDir(), {}, {});
  assert.equal(config.registry, "https://npm.pkg.github.com");
  assert.equal(config.scope, "@pragmatic-tech-ai");
  assert.equal(config.org, "pragmatic-tech-ai");
  assert.equal(config.token, "");
});

test(".npmrc supplies registry and interpolated auth token", () => {
  const dir = projectDir(
    "@pragmatic-tech-ai:registry=https://npm.pkg.github.com\n//npm.pkg.github.com/:_authToken=${GH_PAT}\n",
  );
  const config = resolveRegistryConfig(dir, {}, { GH_PAT: "secret-123" });
  assert.equal(config.registry, "https://npm.pkg.github.com");
  assert.equal(config.token, "secret-123");
});

test("env token overrides .npmrc, flags override env", () => {
  const dir = projectDir("//npm.pkg.github.com/:_authToken=from-npmrc\n");
  const envOnly = resolveRegistryConfig(dir, {}, { NODE_AUTH_TOKEN: "from-env" });
  assert.equal(envOnly.token, "from-env");

  const flagWins = resolveRegistryConfig(dir, { token: "from-flag" }, { NODE_AUTH_TOKEN: "from-env" });
  assert.equal(flagWins.token, "from-flag");
});

test("flags override registry, scope, and derive org", () => {
  const config = resolveRegistryConfig(projectDir(), { registry: "https://example.test", scope: "@acme" }, {});
  assert.equal(config.registry, "https://example.test");
  assert.equal(config.scope, "@acme");
  assert.equal(config.org, "acme");
});
