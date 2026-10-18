import type { Scalar } from "../manifest/logical.js";
import type { ICypherGraph } from "./graph.js";

export interface CypherWriteStatsDto
{
    NodesCreated: number;
    NodesDeleted: number;
    RelationshipsCreated: number;
    RelationshipsDeleted: number;
    PropertiesSet: number;
}

export class CypherWriteStats
{
    constructor(
        public NodesCreated: number = 0,
        public NodesDeleted: number = 0,
        public RelationshipsCreated: number = 0,
        public RelationshipsDeleted: number = 0,
        public PropertiesSet: number = 0,
    )
    {
    }

    public ToDto(): CypherWriteStatsDto
    {
        return {
            NodesCreated: this.NodesCreated,
            NodesDeleted: this.NodesDeleted,
            RelationshipsCreated: this.RelationshipsCreated,
            RelationshipsDeleted: this.RelationshipsDeleted,
            PropertiesSet: this.PropertiesSet,
        };
    }
}

export interface ICypherWriter
{
    // concept is a resolved fullName; returns the new node id.
    CreateNode(concept: string, properties: ReadonlyMap<string, Scalar>): string;
    SetProperty(nodeId: string, name: string, value: Scalar): void;
    RemoveProperty(nodeId: string, name: string): void;
    // false if the reference is already present (idempotent).
    CreateRelationship(fromId: string, member: string, toId: string): boolean;
    // false if absent.
    DeleteRelationship(fromId: string, member: string, toId: string): boolean;
    // Non-detach delete of a node with incident edges throws CypherWriteError.
    DeleteNode(nodeId: string, detach: boolean): void;
    Begin(): void;
    // Returns the re-baked read graph after mutations.
    Commit(): ICypherGraph;
    Rollback(): void;
    Stats(): CypherWriteStats;
}
