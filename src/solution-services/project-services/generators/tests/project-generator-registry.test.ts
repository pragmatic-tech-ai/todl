import { test } from "node:test";
import { strictEqual, throws, deepStrictEqual } from "node:assert";
import { type IProjectContentGenerator, WritePolicy } from "../project-content-generator.js";
import { ProjectGeneratorRegistry } from "../project-generator-registry.js";

const MakeFakeGenerator = (id: string): IProjectContentGenerator =>
{
    return {
        Id: id,
        DisplayName: `Generator ${id}`,
        Produces: [],
        Triggers: [],
        WritePolicy: WritePolicy.Overwrite,
        Generate: async () => ({ Written: [], Skipped: [] }),
    };
};

test("ProjectGeneratorRegistry", async (t) =>
{
    await t.test("Register two generators under 'architecture'; For returns both in registration order", () =>
    {
        const registry = new ProjectGeneratorRegistry();
        const gen1 = MakeFakeGenerator("gen1");
        const gen2 = MakeFakeGenerator("gen2");

        registry.Register("architecture", gen1);
        registry.Register("architecture", gen2);

        const result = registry.For("architecture");
        strictEqual(result.length, 2);
        strictEqual(result[0], gen1);
        strictEqual(result[1], gen2);
    });

    await t.test("For('library') returns empty array", () =>
    {
        const registry = new ProjectGeneratorRegistry();
        const result = registry.For("library");
        deepStrictEqual(result, []);
    });

    await t.test("Get(id) returns matching generator; Get('nope') returns undefined", () =>
    {
        const registry = new ProjectGeneratorRegistry();
        const gen1 = MakeFakeGenerator("gen1");

        registry.Register("architecture", gen1);

        strictEqual(registry.Get("gen1"), gen1);
        strictEqual(registry.Get("nope"), undefined);
    });

    await t.test("Registering a second generator with already-used Id throws with message containing the id", () =>
    {
        const registry = new ProjectGeneratorRegistry();
        const gen1 = MakeFakeGenerator("gen1");
        const gen2 = MakeFakeGenerator("gen1");

        registry.Register("architecture", gen1);

        throws(
            () =>
            {
                registry.Register("architecture", gen2);
            },
            (err: Error) =>
            {
                return err.message.includes("gen1");
            }
        );
    });
});
