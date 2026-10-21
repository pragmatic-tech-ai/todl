import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeStorage } from "@pragmatic-tech-ai/todl-runtime";
import { Severity, DiagnosticSink } from "../../../build-system-core/diagnostic-sink.js";
import type { ITypeChecker, TypeCheckRequest, TypeCheckResult } from "../../../build-system-core/type-checker.js";
import { TypeCheckAction } from "../type-check-action.js";

class FakeChecker implements ITypeChecker
{
    public lastRequest: TypeCheckRequest | undefined;
    public constructor(private readonly result: TypeCheckResult) {}
    public async Check(request: TypeCheckRequest): Promise<TypeCheckResult>
    {
        this.lastRequest = request;
        return this.result;
    }
}

class Fixtures
{
    // Minimal TodlBuildContext: only the fields TypeCheckAction reads (Project storage
    // + Diagnostics). Cast through unknown — the action touches nothing else.
    public static ContextWith(project: FakeStorage, sink: DiagnosticSink): any
    {
        return { Project: project, Sandbox: project, Diagnostics: sink } as unknown;
    }

    public static async ProjectWith(files: Record<string, string>): Promise<FakeStorage>
    {
        const s = new FakeStorage();
        for (const [path, text] of Object.entries(files)) await s.WriteText(path, text);
        return s;
    }
}

test("stages only TypeScript files from src/ and generated/ with canonical options", async () =>
{
    const project = await Fixtures.ProjectWith({
        "src/main.ts": "export const a = 1;",
        "src/app.mu": "ignored",
        "generated/data.ts": "export const b = 2;",
    });
    const checker = new FakeChecker({ Diagnostics: [] });
    await new TypeCheckAction(checker).Execute(Fixtures.ContextWith(project, new DiagnosticSink()));
    const staged = checker.lastRequest!.Files.map((f) => f.Path).sort();
    assert.deepEqual(staged, ["generated/data.ts", "src/main.ts"]);
    assert.equal(checker.lastRequest!.Options.Target, "ES2020");
});

test("an error diagnostic is reported (fails the build)", async () =>
{
    const project = await Fixtures.ProjectWith({ "src/main.ts": "export const a: number = 'x';" });
    const sink = new DiagnosticSink();
    const checker = new FakeChecker({ Diagnostics: [{ severity: Severity.Error, message: "boom", source: "type-check" }] });
    const checkpoint = sink.Count;
    await new TypeCheckAction(checker).Execute(Fixtures.ContextWith(project, sink));
    assert.equal(sink.HasErrorsSince(checkpoint), true);
});

test("a warning diagnostic does not fail the build", async () =>
{
    const project = await Fixtures.ProjectWith({ "src/main.ts": "export const a = 1;" });
    const sink = new DiagnosticSink();
    const checker = new FakeChecker({ Diagnostics: [{ severity: Severity.Warning, message: "meh", source: "type-check" }] });
    const checkpoint = sink.Count;
    await new TypeCheckAction(checker).Execute(Fixtures.ContextWith(project, sink));
    assert.equal(sink.HasErrorsSince(checkpoint), false);
    assert.equal(sink.Count, checkpoint + 1); // still recorded
});
