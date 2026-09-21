import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ArtifactKey } from "../artifact-key.js";
import { BuildArtifacts } from "../build-artifacts.js";

describe("BuildArtifacts", () =>
{
    test("Get returns the value Set under a key", () =>
    {
        const key = new ArtifactKey<number>("Count");
        const bag = new BuildArtifacts();
        bag.Set(key, 42);
        assert.equal(bag.Get(key), 42);
    });

    test("Get returns undefined for a key never Set", () =>
    {
        const bag = new BuildArtifacts();
        assert.equal(bag.Get(new ArtifactKey<string>("Missing")), undefined);
    });

    test("keys are identity-scoped: same description, independent slots", () =>
    {
        const a = new ArtifactKey<string>("Same");
        const b = new ArtifactKey<string>("Same");
        const bag = new BuildArtifacts();
        bag.Set(a, "a");
        bag.Set(b, "b");
        assert.equal(bag.Get(a), "a");
        assert.equal(bag.Get(b), "b");
    });
});
