import { test } from "node:test";
import assert from "node:assert/strict";
import { ServiceKey } from "@pragmatic-tech-ai/todl-runtime";
import { ResolutionAuditSinkKey } from "../resolution-audit-sink.js";

test("ResolutionAuditSinkKey is a ServiceKey", () =>
{
    assert.ok(ResolutionAuditSinkKey instanceof ServiceKey);
});
