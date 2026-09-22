import { DomainHost } from "../../domain/domain-host.js";
import { BundledContributor } from "../../domain/contributor.js";
import type { PackageRef, ResolvedPackage } from "../../domain/domain.js";
import { GraphExplorer } from "./ui.js";

declare global
{
    interface Window { __TODL_PACKAGES__?: { packages: ResolvedPackage[]; entry: PackageRef[] }; }
}

// Bootstrap for the bundled page: read the inlined packages, compose them through
// one DomainHost + BundledContributor, mount the explorer. The single trailing
// invocation is the module's entry point.
export class BundledHostBootstrap
{
    private static readonly RootId = "todl-app-root";

    public static async Main(): Promise<void>
    {
        if (typeof document === "undefined" || typeof window === "undefined") return; // no DOM (e.g. Node import)
        const root = document.getElementById(BundledHostBootstrap.RootId);
        const inlined = window.__TODL_PACKAGES__;
        if (root === null || inlined === undefined) return;
        const host = await DomainHost.Compose([new BundledContributor(inlined.packages, inlined.entry)]);
        new GraphExplorer(host.Query(), root).Render();
    }
}

void BundledHostBootstrap.Main();
