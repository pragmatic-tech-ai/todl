import { test } from "node:test";
import assert from "node:assert/strict";
import { Repository } from "../../compiler-services/model/model.js";
import { toJSON } from "../../compiler-services/emit/json.js";
import type { TodlDocument } from "../../compiler-services/emit/json.js";
import { ModelDataSource } from "../model-data-source.js";
import type { IInstanceView } from "../instance-filter.js";

class FilterTestData
{
    public static readonly Concept = "account";
    public static readonly Region = "region";
    public static readonly Eu = "eu";
    public static readonly Us = "us";

    public static Doc(): TodlDocument
    {
        const r = new Repository();
        const b = r.builder();
        b.definePrimitive("string");
        b.defineConcept(FilterTestData.Concept);
        b.addField(FilterTestData.Concept, FilterTestData.Region, "string");
        const rows: [string, string][] = [["acme", "eu"], ["globex", "us"], ["initech", "eu"]];
        for (const [id, region] of rows)
        {
            b.assertInstance(FilterTestData.Concept, id);
            b.setField(id, FilterTestData.Region, region);
        }
        b.commit();
        return toJSON(r);
    }
}

class FilterTestSource extends ModelDataSource
{
    constructor()
    {
        super();
        this.modelName = "filtertest";
        this.modelVersion = "0.0.0";
        this.loadDocument(FilterTestData.Doc());
    }
}

test("instance filter gates Instances and entity(id); unset restores all", () =>
{
    const source = new FilterTestSource();
    // Prime the entity cache first: a cache hit must not bypass the filter.
    assert.ok(source.entity("globex") !== undefined);

    source.UseInstanceFilter({ Keep: (v: IInstanceView) => v.Field(FilterTestData.Region) === FilterTestData.Eu });
    const kept = source.Instances(FilterTestData.Concept);
    assert.deepEqual(kept.map((e) => e.id).sort(), ["acme", "initech"]);
    assert.equal(source.entity("globex"), undefined);
    assert.ok(source.entity("acme") !== undefined);

    source.UseInstanceFilter(undefined);
    assert.equal(source.Instances(FilterTestData.Concept).length, 3);
    assert.ok(source.entity("globex") !== undefined);
});
