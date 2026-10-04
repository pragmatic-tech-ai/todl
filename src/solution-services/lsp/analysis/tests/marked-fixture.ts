import type { Position } from "vscode-languageserver-types";
import { AnalysisSnapshot } from "../analysis-snapshot.js";

export interface MarkedFixture
{
    analysis: AnalysisSnapshot;
    positions: Position[];
    uri: string;
}

// Parse a marked source: every `‸` records a 0-based LSP Position (in order) and
// is removed from the text; the cleaned text is analyzed as a single-file project.
export class MarkedSource
{
    private static readonly Marker = "‸";

    public static Fixture(uri: string, marked: string): MarkedFixture
    {
        const positions: Position[] = [];
        let line = 0;
        let character = 0;
        let text = "";
        for (const ch of marked)
        {
            if (ch === MarkedSource.Marker)
            {
                positions.push({ line, character });
                continue;
            }
            text += ch;
            if (ch === "\n")
            {
                line += 1;
                character = 0;
            }
            else
            {
                character += 1;
            }
        }
        return { analysis: AnalysisSnapshot.Build([{ uri, text }]), positions, uri };
    }
}
