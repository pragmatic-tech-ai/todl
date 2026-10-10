import { test } from "node:test";
import assert from "node:assert/strict";
import { check, mergeBases } from "../../compiler-services/api.js";
import { toJSON } from "../../compiler-services/emit/json.js";
import { Repository } from "../../compiler-services/model/model.js";
import { SnowflakeIdGenerator } from "../../compiler-services/model/id-generator.js";
import { loadInto } from "../../compiler-services/parse/loader.js";
import { preludeDocument, preludeNames } from "../../compiler-services/stdlib/prelude.js";
import { TODL, type TodlDefinition } from "../index.js";

const MODEL = `namespace n
{
    concept C { k : string; }
    identity C key k;
    model M : n
    {
        C a { k = "dup"; }
        C b { k = "dup"; }
    }
}`;

class ComposeFixture
{
    // An UNRESOLVED document: loadInto does NOT run ResolutionPass (unlike check).
    static unresolvedDoc()
    {
        const model = new Repository(mergeBases([preludeDocument()]));
        loadInto(model, [{ uri: "n.todl", text: MODEL }], preludeNames(), new SnowflakeIdGenerator(), new Map());
        return toJSON(model);
    }

    static instanceCount(graph: ReturnType<typeof TODL.ComposeGraph>): number
    {
        const def = graph.GetDefinition("n.C") as TodlDefinition;
        let count = 0;
        for (const m of graph.Models)
        {
            for (const d of m.GetDefinitions())
            {
                if (d.Is(def)) count += [...m.GetInstances(d)].length;
            }
        }
        return count;
    }
}

test("the runtime resolves identity clusters when composing an unresolved document", () =>
{
    const graph = TODL.ComposeGraph([ComposeFixture.unresolvedDoc()], []);
    assert.equal(ComposeFixture.instanceCount(graph), 1);
});

test("re-composing an already-resolved document is idempotent", () =>
{
    const resolved = toJSON(check([{ uri: "n.todl", text: MODEL }]).model);
    const graph = TODL.ComposeGraph([resolved], []);
    assert.equal(ComposeFixture.instanceCount(graph), 1);
});
