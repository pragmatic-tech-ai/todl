#!/usr/bin/env node
import { createConnection, ProposedFeatures } from "vscode-languageserver/node.js";
import { LspCompositionRoot } from "./lsp-composition-root.js";
import { TodlLanguageServer } from "./todl-language-server.js";

// The `todl-language-server` bin: start the thin JSON-RPC proxy over stdio. It
// composes the `solution-services/lsp` module and serves its ILanguageService to
// an external editor — the module does all analysis; this process is transport
// only. (#15)
export class Main
{
    public static Start(): void
    {
        const connection = createConnection(ProposedFeatures.all);
        const root = new LspCompositionRoot();
        new TodlLanguageServer(root.LanguageService()).Listen(connection);
    }
}

Main.Start();
