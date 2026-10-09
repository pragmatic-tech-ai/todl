import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Severity } from "../../../../build-system-core/diagnostic-sink.js";
import { CanonicalTypeScriptOptions } from "../../../../build-system-core/compiler-options.js";
import { TscTypeChecker } from "../tsc-type-checker.js";

// A checker whose resolution root is a throwaway dir containing an empty
// node_modules, so staging has somewhere to go and no real packages are needed.
class FixtureChecker extends TscTypeChecker
{
    public constructor(private readonly root: string)
    {
        super();
    }

    protected override ResolutionRoot(): string | undefined
    {
        return this.root;
    }
}

class Fixtures
{
    private static readonly RootPrefix = "tsc-check-";
    private static readonly NodeModules = "node_modules";

    public static FreshRoot(): string
    {
        const root = mkdtempSync(join(tmpdir(), Fixtures.RootPrefix));
        mkdirSync(join(root, Fixtures.NodeModules), { recursive: true });
        return root;
    }
}

test("clean program reports no diagnostics", async () =>
{
    const root = Fixtures.FreshRoot();
    try
    {
        const checker = new FixtureChecker(root);
        const result = await checker.Check({
            Options: CanonicalTypeScriptOptions,
            Files: [{ Path: "src/main.ts", Text: "export const n: number = 1;\n" }],
        });
        assert.deepEqual(result.Diagnostics, []);
    }
    finally
    {
        rmSync(root, { recursive: true, force: true });
    }
});

test("a .js import resolves to its .ts sibling under bundler resolution", async () =>
{
    const root = Fixtures.FreshRoot();
    try
    {
        const checker = new FixtureChecker(root);
        const result = await checker.Check({
            Options: CanonicalTypeScriptOptions,
            Files: [
                { Path: "generated/data.ts", Text: "export const Value: number = 1;\n" },
                { Path: "src/main.ts", Text: "import { Value } from '../generated/data.js';\nexport const x: number = Value;\n" },
            ],
        });
        assert.deepEqual(result.Diagnostics, []);
    }
    finally
    {
        rmSync(root, { recursive: true, force: true });
    }
});

test("a type error is reported as a Severity.Error diagnostic", async () =>
{
    const root = Fixtures.FreshRoot();
    try
    {
        const checker = new FixtureChecker(root);
        const result = await checker.Check({
            Options: CanonicalTypeScriptOptions,
            Files: [{ Path: "src/main.ts", Text: "export const n: number = 'not a number';\n" }],
        });
        assert.equal(result.Diagnostics.length >= 1, true);
        assert.equal(result.Diagnostics[0]!.severity, Severity.Error);
        assert.match(result.Diagnostics[0]!.message, /not assignable/i);
    }
    finally
    {
        rmSync(root, { recursive: true, force: true });
    }
});

test("no resolution root yields a single explanatory error, not a throw", async () =>
{
    const checker = new FixtureChecker(undefined as unknown as string);
    const result = await checker.Check({ Options: CanonicalTypeScriptOptions, Files: [] });
    assert.equal(result.Diagnostics.length, 1);
    assert.equal(result.Diagnostics[0]!.severity, Severity.Error);
});
