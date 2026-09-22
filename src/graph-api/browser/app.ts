import { GraphApi } from "../graph-api.js";
import type { TodlDocument } from "../../compiler-services/emit/json.js";
import { GraphExplorer } from "./ui.js";

declare global
{
    interface Window { __TODL_DOCUMENT__?: TodlDocument; }
}

// Bootstrap for the bundled page: read the inlined document and mount the explorer.
// The single trailing invocation is the module's entry point.
class GraphAppBootstrap
{
    private static readonly RootId = "todl-app-root";

    public static Main(): void
    {
        const root = document.getElementById(GraphAppBootstrap.RootId);
        const inlined = window.__TODL_DOCUMENT__;
        if (root === null || inlined === undefined) return;
        new GraphExplorer(GraphApi.FromDocument(inlined), root).Render();
    }
}

GraphAppBootstrap.Main();
