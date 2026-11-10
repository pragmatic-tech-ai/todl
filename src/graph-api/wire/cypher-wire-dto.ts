import type { Scalar } from "../../manifest/logical.js";
import type { MirrorSnapshot } from "../snapshot.js";

/** A node cell: its snapshot under the reserved `$node` key (see CypherCellCodec). */
export interface NodeCellDto
{
    readonly $node: MirrorSnapshot;
}

export type CypherValueDto = NodeCellDto | Scalar | null | CypherValueDto[] | { [k: string]: CypherValueDto };

export interface CypherWriteStatsDto
{
    NodesCreated: number;
    NodesDeleted: number;
    RelationshipsCreated: number;
    RelationshipsDeleted: number;
    PropertiesSet: number;
}

export interface CypherResultDto
{
    Columns: string[];
    Rows: CypherValueDto[][];
    Truncated: boolean;
    HasMore: boolean;
    Stats?: CypherWriteStatsDto;
}
