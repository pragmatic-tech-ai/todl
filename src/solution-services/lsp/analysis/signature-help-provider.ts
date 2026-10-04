import type { SignatureHelp, SignatureInformation, Position } from "vscode-languageserver-types";
import { Cardinality } from "../../../compiler-services/model/graph.js";
import type { AnalysisSnapshot } from "./analysis-snapshot.js";
import { SchemaContextResolver } from "./schema-context-resolver.js";

export class SignatureHelpProvider
{
    private static readonly Card: Record<number, string> = {
        [Cardinality.One]: "", [Cardinality.Optional]: "?",
        [Cardinality.Many]: "[]", [Cardinality.OneOrMore]: "[+]",
    };
    private static readonly RelationshipArrow = "->";
    private static readonly FieldArrow = ":";
    private static readonly TargetSeparator = " | ";

    public SignatureHelpAt(a: AnalysisSnapshot, uri: string, pos: Position): SignatureHelp | null
    {
        const ctx = SchemaContextResolver.AssignmentContextAt(a, uri, pos);
        if (ctx === null || ctx.TargetConcepts.length === 0) return null;
        const arrow = ctx.IsRelationship ? SignatureHelpProvider.RelationshipArrow : SignatureHelpProvider.FieldArrow;
        const card = SignatureHelpProvider.Card[ctx.Cardinality] ?? "";
        const label = `${ctx.Member} ${arrow} ${ctx.TargetConcepts.join(SignatureHelpProvider.TargetSeparator)}${card}`;
        const signature: SignatureInformation = { label };
        return { signatures: [signature], activeSignature: 0, activeParameter: 0 };
    }
}
