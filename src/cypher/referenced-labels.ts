import { CypherParser } from "./parser.js";
import { MatchClause } from "./query-model.js";
import type { CypherQueryModel } from "./query-model.js";

export class ReferencedLabels
{
    public static Of(text: string): { labels: readonly string[]; wildcard: boolean; parseFailed: boolean }
    {
        const labels = new Set<string>();
        let wildcard = false;
        try
        {
            const model = new CypherParser(text).Parse();
            for (const label of ReferencedLabels.NodeLabels(model))
            {
                if (label === undefined)
                {
                    wildcard = true;
                }
                else
                {
                    labels.add(label);
                }
            }
        }
        catch
        {
            return { labels: [], wildcard: false, parseFailed: true };
        }
        return { labels: [...labels], wildcard, parseFailed: false };
    }

    // Walk MATCH / OPTIONAL MATCH node patterns; yield each node's Label (undefined when absent).
    private static *NodeLabels(model: CypherQueryModel): Iterable<string | undefined>
    {
        for (const part of model.Parts)
        {
            for (const clause of part.Reading)
            {
                if (!(clause instanceof MatchClause))
                {
                    continue;
                }
                for (const path of clause.Paths)
                {
                    for (const node of path.Nodes)
                    {
                        yield node.Label;
                    }
                }
            }
        }
    }
}
