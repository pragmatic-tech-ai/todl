// Bootstrap for the mural-hosted bundled page: read the inlined { shards, root } payload,
// build a ModelRegistry, run it through MuralHost, and mount into the page root via an
// HtmlTarget. The trailing invocation is the module entry point. Node imports (no DOM)
// return early so the bundle is inert outside a browser.

import { HtmlTarget } from "@pragmatic-tech-ai/mural/visual-engine";
import { MuralHost } from "../../application/mural-host.js";
import { BundledModelRegistry, type BundledAppPayload } from "../../model-data/bundled-model-registry.js";

declare global
{
    interface Window { __TODL_APP__?: BundledAppPayload; }
}

export class MuralBundledHost
{
    private static readonly RootId = "todl-app-root";

    public static async Main(): Promise<void>
    {
        if (typeof document === "undefined" || typeof window === "undefined") return; // no DOM (e.g. Node import)
        const host = document.getElementById(MuralBundledHost.RootId);
        const payload = window.__TODL_APP__;
        if (host === null || payload === undefined) return;
        const registry = BundledModelRegistry.From(payload);
        const { app } = await MuralHost.Run(registry);
        app.initialize(new HtmlTarget(host));
    }
}

void MuralBundledHost.Main();
