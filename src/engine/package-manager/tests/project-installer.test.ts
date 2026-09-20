import { test } from "node:test";
import assert from "node:assert/strict";
import { ProjectInstaller } from "../project-installer.js";

test("install runs `npm install` in the given directory", async () => {
  const calls: { args: readonly string[]; cwd: string }[] = [];
  const runner = (args: readonly string[], cwd: string) => {
    calls.push({ args, cwd });
    return Promise.resolve(0);
  };
  const code = await new ProjectInstaller(runner).install("/proj");
  assert.equal(code, 0);
  assert.deepEqual(calls, [{ args: ["install"], cwd: "/proj" }]);
});

test("install propagates npm's non-zero exit code", async () => {
  const code = await new ProjectInstaller(() => Promise.resolve(1)).install("/proj");
  assert.equal(code, 1);
});
