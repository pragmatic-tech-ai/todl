import type { ConnectorBinding, ExternalRecord } from "./connector-plan.js";
import type { ReflectedNode } from "../manifest/reflection/reflection.js";
import type { Scalar } from "../compiler-services/model/graph.js";

/** Maps one external record to a reflectable node, matching PopulationBuilder's FieldMap/IdKey inversion and synthetic-id scheme. */
export class ConnectorMirrorMapper
{
    private static readonly IdSeparator = "#";
    private static readonly NamespaceSeparator = ".";

    public static NodeFor(binding: ConnectorBinding, record: ExternalRecord): ReflectedNode | undefined
    {
        const idValue = record[binding.IdKey];
        if (idValue === undefined || idValue === null)
        {
            return undefined;
        }
        const storageId = String(idValue);
        // External field -> member; the id member's value is carried by the id, not stamped as an attr.
        const inverse = new Map<string, string>();
        for (const [member, external] of Object.entries(binding.FieldMap))
        {
            if (external === binding.IdKey)
            {
                continue;
            }
            inverse.set(external, member);
        }
        const attrs: Record<string, Scalar> = {};
        for (const [external, value] of Object.entries(record))
        {
            const member = inverse.get(external);
            if (member === undefined || value === null || value === undefined)
            {
                continue;
            }
            attrs[member] = value;
        }
        const split = binding.Concept.lastIndexOf(ConnectorMirrorMapper.NamespaceSeparator);
        const sourceTag = `${binding.Connector}${ConnectorMirrorMapper.NamespaceSeparator}${binding.Source}`;
        const id = `${binding.Concept}${ConnectorMirrorMapper.IdSeparator}${sourceTag}${ConnectorMirrorMapper.IdSeparator}${storageId}`;
        const node: ReflectedNode = { id, type: binding.Concept, attrs };
        if (split >= 0)
        {
            node.namespace = binding.Concept.slice(0, split);
        }
        return node;
    }
}
