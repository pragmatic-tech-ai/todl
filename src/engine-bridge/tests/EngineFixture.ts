import { BindingTable, GraphEngine, StorageKind, type IEngineStorage, type IGraphConnector } from "@pragmatic-tech-ai/graph";
import type { MetadataSnapshot } from "../../domain/metadata-snapshot.js";
import { SnapshotDescriber } from "../SnapshotDescriber.js";
import type { ISnapshotDescription } from "../SnapshotDescription.js";

/** How EngineFixture.Open runs the engine: its storage (memory by default) and its connectors (none by default). */
export interface IEngineFixtureOptions
{
    readonly Storage?: IEngineStorage;
    readonly Connectors?: readonly IGraphConnector[];
}

/** The engine side of the fixture agreement checks; the fixtures themselves come from ManifestFixture (engine-free). */
export class EngineFixture
{
    public static Describe(snapshot: MetadataSnapshot): ISnapshotDescription
    {
        return SnapshotDescriber.Describe(snapshot, { DefaultConnector: BindingTable.EngineStorage });
    }

    /** Opens the described schema on an engine over `options.Storage` with `options.Connectors`; the caller disposes it. */
    public static async Open(description: ISnapshotDescription, options: IEngineFixtureOptions = {}): Promise<GraphEngine>
    {
        return GraphEngine.Open({
            Description: description.Description,
            Storage: options.Storage ?? { Kind: StorageKind.Memory },
            Connectors: options.Connectors ?? [],
        });
    }
}
