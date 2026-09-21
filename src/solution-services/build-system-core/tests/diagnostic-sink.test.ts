import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { DiagnosticSink, Severity } from "../diagnostic-sink.js";

describe("DiagnosticSink", () =>
{
    test("HasErrorsSince(0) is false when only warnings were reported", () =>
    {
        const sink = new DiagnosticSink();
        sink.Report({ severity: Severity.Warning, message: "heads up" });
        assert.equal(sink.HasErrorsSince(0), false);
    });

    test("HasErrorsSince detects an error added after the checkpoint", () =>
    {
        const sink = new DiagnosticSink();
        sink.Report({ severity: Severity.Error, message: "old" });
        const checkpoint = sink.Count;
        sink.Report({ severity: Severity.Error, message: "new" });
        assert.equal(sink.HasErrorsSince(checkpoint), true);
    });

    test("HasErrorsSince ignores diagnostics before the checkpoint", () =>
    {
        const sink = new DiagnosticSink();
        sink.Report({ severity: Severity.Error, message: "old" });
        const checkpoint = sink.Count;
        sink.Report({ severity: Severity.Warning, message: "new warn" });
        assert.equal(sink.HasErrorsSince(checkpoint), false);
    });

    test("All returns every reported diagnostic in order", () =>
    {
        const sink = new DiagnosticSink();
        sink.Report({ severity: Severity.Warning, message: "a" });
        sink.Report({ severity: Severity.Error, message: "b" });
        assert.deepEqual(sink.All().map((d) => d.message), ["a", "b"]);
    });
});
