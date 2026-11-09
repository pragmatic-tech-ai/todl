import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BindingTable, GraphEngine, StorageKind } from "@pragmatic-tech-ai/graph";
import { load } from "../../compiler-services/parse/loader.js";
import type { Repository } from "../../compiler-services/model/model.js";
import { ManifestEmitter } from "../../compiler-services/emit/manifest.js";
import { ManifestWriter } from "../../manifest/manifest-writer.js";
import { Manifest } from "../../manifest/reflection/reflection.js";
import { MetadataSnapshot } from "../../domain/metadata-snapshot.js";
import { SnapshotDescriber } from "../SnapshotDescriber.js";
import type { ISnapshotDescription } from "../SnapshotDescription.js";

/**
 * Loads the parse fixtures into a Repository, binds them into a MetadataSnapshot (the path the fixtures that do not
 * compile through compilePackage can take), and opens the described schema on an in-memory graph engine.
 */
export class EngineFixture
{
    private static readonly FixtureDir = new URL("../../compiler-services/parse/tests/fixtures/", import.meta.url);
    private static readonly Model = "agree";
    private static readonly Version = "1.0.0";
    private static readonly FixtureExtension = ".todl";
    public static readonly ExpectedUnbindable = ["demo.orderFulfillment.orderToValidate", "demo.orderFulfillment.sales"];
    /** The metamodel fixtures the instance fixtures import; loaded with every fixture so its types resolve. */
    private static readonly Dependencies = ["primitives.todl", "enums.todl", "concepts.todl"];

    public static FixtureNames(): string[]
    {
        return readdirSync(fileURLToPath(EngineFixture.FixtureDir))
            .filter((f) => f.endsWith(EngineFixture.FixtureExtension))
            .sort();
    }

    public static Source(name: string): { uri: string; text: string }
    {
        const text = readFileSync(fileURLToPath(new URL(name, EngineFixture.FixtureDir)), "utf8");
        return { uri: name, text };
    }

    public static Repo(names: string[]): Repository
    {
        const all = [...new Set([...EngineFixture.Dependencies, ...names])];
        return load(all.map((n) => EngineFixture.Source(n))).model;
    }

    /** Ids of the data nodes whose type the metamodel never declares, so they cannot bind. */
    public static Unbindable(repo: Repository): string[]
    {
        const { manifest, graph } = new ManifestEmitter(repo, EngineFixture.Model, EngineFixture.Version).emit();
        const known = new Set(Object.keys(manifest.concepts));
        return graph.nodes.filter((n) => !known.has(n.type)).map((n) => n.id).sort();
    }

    public static Graph(repo: Repository): MetadataSnapshot
    {
        const { manifest, graph } = new ManifestEmitter(repo, EngineFixture.Model, EngineFixture.Version).emit();
        const reflected = Manifest.load(ManifestWriter.fromLogical(manifest).toBinary());
        const frozen = new MetadataSnapshot();
        frozen.PreRegister(reflected);
        frozen.Finalize(reflected);
        const unbindable = new Set(EngineFixture.Unbindable(repo));
        const nodes = graph.nodes.filter((n) => !unbindable.has(n.id));
        const ids = new Set(nodes.map((n) => n.id));
        const edges = graph.edges.filter((e) => ids.has(e.from) && ids.has(e.to));
        frozen.BindSeed({ ...graph, nodes, edges }, graph.manifestRef);
        return frozen;
    }

    public static Describe(snapshot: MetadataSnapshot): ISnapshotDescription
    {
        return SnapshotDescriber.Describe(snapshot, { DefaultConnector: BindingTable.EngineStorage });
    }

    /** Opens the described schema on a memory engine; the caller disposes it. */
    public static async Open(description: ISnapshotDescription): Promise<GraphEngine>
    {
        return GraphEngine.Open({ Description: description.Description, Storage: { Kind: StorageKind.Memory } });
    }
}
