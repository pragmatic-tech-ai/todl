import { BindingTable, GraphEngine, StorageKind } from "@pragmatic-tech-ai/graph";
import type { MetadataSnapshot } from "../../domain/metadata-snapshot.js";
import { SnapshotDescriber } from "../SnapshotDescriber.js";
import type { ISnapshotDescription } from "../SnapshotDescription.js";

/** The engine side of the fixture agreement checks; the fixtures themselves come from ManifestFixture (engine-free). */
export class EngineFixture
{
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
