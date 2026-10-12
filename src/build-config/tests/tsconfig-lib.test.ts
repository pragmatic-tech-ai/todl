import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Guards the self-contained build: TODL uses DOM-provided globals (`document`,
// `window`, `BodyInit`) in build-included source, so its own base tsconfig must
// declare the DOM lib rather than relying on a dependency (mural) to inject it.
class BaseTsconfig
{
    private static readonly RelativePath = join("..", "..", "..", "tsconfig.json");

    public static Lib(): readonly string[]
    {
        const here = dirname(fileURLToPath(import.meta.url));
        const raw = readFileSync(join(here, BaseTsconfig.RelativePath), "utf8");
        const parsed = JSON.parse(raw) as { compilerOptions?: { lib?: readonly string[] } };
        return parsed.compilerOptions?.lib ?? [];
    }
}

test("base tsconfig lib includes ES2022 and DOM", () =>
{
    const lib = BaseTsconfig.Lib();
    assert.ok(lib.includes("ES2022"), `expected lib to include ES2022, got ${JSON.stringify(lib)}`);
    assert.ok(lib.includes("DOM"), `expected lib to include DOM, got ${JSON.stringify(lib)}`);
});
