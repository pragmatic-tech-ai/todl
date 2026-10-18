import { CypherParser } from "./parser.js";
import { MatchClause, CreateClause, MergeClause } from "./query-model.js";
import type { PatternPath } from "./patterns.js";
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

    // Walk MATCH / CREATE / MERGE node patterns; yield each node's Label (undefined when absent).
    private static *NodeLabels(model: CypherQueryModel): Iterable<string | undefined>
    {
        for (const part of model.Parts)
        {
            for (const clause of part.Reading)
            {
                let paths: readonly PatternPath[];
                if (clause instanceof MatchClause || clause instanceof CreateClause) paths = clause.Paths;
                else if (clause instanceof MergeClause) paths = [clause.Pattern];
                else continue;
                for (const path of paths)
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
