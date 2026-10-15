import { test } from "node:test";
import assert from "node:assert/strict";
import type { IInstanceMirror } from "../index.js";

// A purely external implementer proves IInstanceMirror is public + implementable (compile-level gate).
class StubMirror implements IInstanceMirror
{
    public readonly node = { id: "n1", type: "T", attrs: { a: 1 } };
    public get type(): never { throw new Error("unused"); }
    public get class(): undefined { return undefined; }
    public fields(): never[] { return []; }
    public field(): undefined { return undefined; }
}

test("IInstanceMirror is exported from the graph-api subpath and is externally implementable", () =>
{
    const m: IInstanceMirror = new StubMirror();
    assert.equal(m.node.id, "n1");
    assert.equal(m.field("x"), undefined);
    assert.deepEqual(m.fields(), []);
});
