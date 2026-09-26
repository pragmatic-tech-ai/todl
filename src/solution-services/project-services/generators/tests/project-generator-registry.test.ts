import { test } from "node:test";
import { strictEqual, throws, deepStrictEqual } from "node:assert";
import { type IProjectContentGenerator, WritePolicy } from "../project-content-generator.js";
import { ProjectGeneratorRegistry } from "../project-generator-registry.js";
import { type GeneratorDefinition } from "../generator-definition.js";
import { type IServiceProvider, ServiceKey } from "@pragmatic-tech-ai/todl-runtime";

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

    await t.test("Registering a second generator with already-used Id is idempotent (dedup by id, no throw)", () =>
    {
        const registry = new ProjectGeneratorRegistry();
        const gen1 = MakeFakeGenerator("gen1");
        const gen2 = MakeFakeGenerator("gen1");

        registry.Register("architecture", gen1);
        registry.Register("architecture", gen2);

        const result = registry.For("architecture");
        strictEqual(result.length, 1);
        strictEqual(result[0], gen1);
    });

    await t.test("Factory-sourced and standalone definition with same Id register once (dedup)", () =>
    {
        const registry = new ProjectGeneratorRegistry();
        const gen1 = MakeFakeGenerator("shared-gen");

        registry.Register("architecture", gen1);

        // Simulate RegisterDefinition by resolving from provider
        const mockProvider: IServiceProvider = {
            getRequired: <T>(_token: ServiceKey<T>): T =>
            {
                return MakeFakeGenerator("shared-gen") as T;
            },
        };

        const def: GeneratorDefinition = {
            ProjectType: "architecture",
            Generator: new ServiceKey("shared-gen"),
        };

        registry.RegisterDefinition(mockProvider, def);

        const result = registry.For("architecture");
        strictEqual(result.length, 1);
        strictEqual(result[0], gen1);
    });

    await t.test("Distinct generator ids both land under For(type)", () =>
    {
        const registry = new ProjectGeneratorRegistry();
        const gen1 = MakeFakeGenerator("gen1");
        const gen2 = MakeFakeGenerator("gen2");

        registry.Register("architecture", gen1);

        const mockProvider: IServiceProvider = {
            getRequired: <T>(_token: ServiceKey<T>): T =>
            {
                return gen2 as T;
            },
        };

        const def: GeneratorDefinition = {
            ProjectType: "architecture",
            Generator: new ServiceKey("gen2"),
        };

        registry.RegisterDefinition(mockProvider, def);

        const result = registry.For("architecture");
        strictEqual(result.length, 2);
        strictEqual(result[0], gen1);
        strictEqual(result[1], gen2);
    });
});
