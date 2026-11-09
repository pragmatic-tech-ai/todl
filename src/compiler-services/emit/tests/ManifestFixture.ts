import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { load } from "../../parse/loader.js";
import type { Repository } from "../../model/model.js";
import { ManifestEmitter } from "../manifest.js";
import { ManifestWriter } from "../../../manifest/manifest-writer.js";
import { Manifest } from "../../../manifest/reflection/reflection.js";
import { MetadataSnapshot } from "../../../domain/metadata-snapshot.js";

/**
 * The parse fixtures as repositories and as frozen manifest snapshots, engine-free: shared by the manifest agreement
 * check here and the engine agreement checks under src/engine-bridge (which add the engine on top).
 */
export class ManifestFixture
{
    private static readonly FixtureDirPath = "../../parse/tests/fixtures/";
    private static readonly Utf8 = "utf8";
    private static readonly FixtureDir = new URL(ManifestFixture.FixtureDirPath, import.meta.url);
    private static readonly Model = "agree";
    private static readonly Version = "1.0.0";
    private static readonly FixtureExtension = ".todl";
    private static readonly OrderFixture = "order-fulfillment.todl";
    private static readonly OrderToValidate = "demo.orderFulfillment.orderToValidate";
    private static readonly Sales = "demo.orderFulfillment.sales";
    /** order-fulfillment.todl uses concepts (Lane, SequenceFlow) its metamodel never declares. */
    private static readonly OrderUnbindable: readonly string[] = [ManifestFixture.OrderToValidate, ManifestFixture.Sales];
    /** The metamodel fixtures the instance fixtures import; loaded with every fixture so its types resolve. */
    private static readonly PrimitivesFile = "primitives.todl";
    private static readonly EnumsFile = "enums.todl";
    private static readonly ConceptsFile = "concepts.todl";
    private static readonly Dependencies = [ManifestFixture.PrimitivesFile, ManifestFixture.EnumsFile, ManifestFixture.ConceptsFile];

    public static FixtureNames(): string[]
    {
        return readdirSync(fileURLToPath(ManifestFixture.FixtureDir))
            .filter((f) => f.endsWith(ManifestFixture.FixtureExtension))
            .sort();
    }

    public static Repo(names: string[]): Repository
    {
        const all = [...new Set([...ManifestFixture.Dependencies, ...names])];
        return load(all.map((n) => ManifestFixture.Source(n))).model;
    }

    /** Ids of the data nodes whose type the metamodel never declares, so they cannot bind. */
    public static Unbindable(repo: Repository): string[]
    {
        const { manifest, graph } = new ManifestEmitter(repo, ManifestFixture.Model, ManifestFixture.Version).emit();
        const known = new Set(Object.keys(manifest.concepts));
        return graph.nodes.filter((n) => !known.has(n.type)).map((n) => n.id).sort();
    }

    /** The unbindable node ids a fixture is known to have (sorted). */
    public static ExpectedUnbindable(name: string): readonly string[]
    {
        return name === ManifestFixture.OrderFixture ? ManifestFixture.OrderUnbindable : [];
    }

    /** The repository emitted, reflected and frozen as a one-manifest snapshot, unbindable nodes left out. */
    public static Graph(repo: Repository): MetadataSnapshot
    {
        const { manifest, graph } = new ManifestEmitter(repo, ManifestFixture.Model, ManifestFixture.Version).emit();
        const reflected = Manifest.load(ManifestWriter.fromLogical(manifest).toBinary());
        const frozen = new MetadataSnapshot();
        frozen.PreRegister(reflected);
        frozen.Finalize(reflected);
        const unbindable = new Set(ManifestFixture.Unbindable(repo));
        const nodes = graph.nodes.filter((n) => !unbindable.has(n.id));
        const ids = new Set(nodes.map((n) => n.id));
        const edges = graph.edges.filter((e) => ids.has(e.from) && ids.has(e.to));
        frozen.BindSeed({ ...graph, nodes, edges }, graph.manifestRef);
        return frozen;
    }

    private static Source(name: string): { uri: string; text: string }
    {
        const text = readFileSync(fileURLToPath(new URL(name, ManifestFixture.FixtureDir)), ManifestFixture.Utf8);
        return { uri: name, text };
    }
}
