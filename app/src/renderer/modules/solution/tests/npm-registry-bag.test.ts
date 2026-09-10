import { test } from "node:test";
import assert from "node:assert/strict";
// Assert on the PURE field specs (no Mural import), so this runs under the app's
// `tsx --test` — which can't statically load the file:-symlinked Mural/todl. The
// bag builder (npm-registry-bag.ts) turns these specs into SettingDefinitions;
// that wiring is exercised by the app build + the solution e2e.
import { NPM_REGISTRY_FIELDS } from "../npm-registry-fields.js";

test("npm-registry has the 5 expected fields and NO literal-token field", () => {
    const keys = NPM_REGISTRY_FIELDS.map((f) => f.key).sort();
    assert.deepEqual(keys, ["org", "registry", "scope", "tokenEnvVar", "tokenSource"]);
    // security invariant: only tokenSource/tokenEnvVar — never token/secret/password
    assert.ok(!keys.some((k) => /^token$|secret|password/i.test(k)));
});

test("tokenSource is a choice of stored|env", () => {
    const tokenSource = NPM_REGISTRY_FIELDS.find((f) => f.key === "tokenSource")!;
    assert.equal(tokenSource.kind, "choice");
    assert.deepEqual(tokenSource.choices, ["stored", "env"]);
});
