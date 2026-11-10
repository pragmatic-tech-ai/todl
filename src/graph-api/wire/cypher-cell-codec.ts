import type { MirrorSnapshot } from "../snapshot.js";
import type { CypherValueDto, NodeCellDto } from "./cypher-wire-dto.js";

/**
 * Non-forgeable encoding of node cells beside user maps. A node is `{ "$node": snapshot }`; a map is a plain object,
 * except a map whose SOLE key is `$node` or `$map` is wrapped as `{ "$map": entries }`. So a one-key `$node` object is
 * always a node and nothing a query builds (map literal, parameter, backtick key) can pass for one.
 */
export class CypherCellCodec
{
    public static readonly NodeKey = "$node";
    public static readonly MapKey = "$map";

    public static EncodeNode(snapshot: MirrorSnapshot): NodeCellDto
    {
        return { [CypherCellCodec.NodeKey]: snapshot } as NodeCellDto;
    }

    public static EncodeMap(entries: { [k: string]: CypherValueDto }): CypherValueDto
    {
        return CypherCellCodec.SoleKey(entries) === undefined ? entries : { [CypherCellCodec.MapKey]: entries };
    }

    /** The node snapshot when `cell` is a node cell; undefined for every other cell. */
    public static AsNode(cell: unknown): MirrorSnapshot | undefined
    {
        if (!CypherCellCodec.IsObject(cell) || CypherCellCodec.SoleKey(cell) !== CypherCellCodec.NodeKey) return undefined;
        return cell[CypherCellCodec.NodeKey] as MirrorSnapshot;
    }

    /** A map cell's entries (unwrapping the `$map` escape); undefined for a node, list, scalar or null. */
    public static AsMap(cell: unknown): { [k: string]: CypherValueDto } | undefined
    {
        if (!CypherCellCodec.IsObject(cell)) return undefined;
        const sole = CypherCellCodec.SoleKey(cell);
        if (sole === CypherCellCodec.NodeKey) return undefined;
        if (sole === CypherCellCodec.MapKey) return cell[CypherCellCodec.MapKey] as { [k: string]: CypherValueDto };
        return cell as { [k: string]: CypherValueDto };
    }

    private static IsObject(cell: unknown): cell is Record<string, unknown>
    {
        return typeof cell === "object" && cell !== null && !Array.isArray(cell);
    }

    // The object's single own key when it is one of the reserved keys; undefined otherwise.
    private static SoleKey(cell: object): string | undefined
    {
        const keys = Object.keys(cell);
        if (keys.length !== 1) return undefined;
        const key = keys[0]!;
        return key === CypherCellCodec.NodeKey || key === CypherCellCodec.MapKey ? key : undefined;
    }
}
