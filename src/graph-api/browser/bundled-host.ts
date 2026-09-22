import { DomainHostBase } from "../../domain/domain-host.js";
import { MemoryPackageSource } from "../../domain/memory-package-source.js";
import type { PackageRef, ResolvedPackage } from "../../domain/domain.js";
import { GraphExplorer } from "./ui.js";

declare global
{
    interface Window { __TODL_PACKAGES__?: { packages: ResolvedPackage[]; entry: PackageRef[] }; }
}

// The browser package source: an in-memory source seeded from the inlined package set.
export class BundledPackageSource extends MemoryPackageSource
{
    constructor(packages: readonly ResolvedPackage[])
    {
        super(packages);
    }
}

// The in-page DomainHost: composes the inlined packages, queries via the shared engine.
export class BundledDomainHost extends DomainHostBase
{
    constructor(packages: readonly ResolvedPackage[])
    {
        super(new BundledPackageSource(packages));
    }
}

// Bootstrap for the bundled page: read the inlined packages, compose the entry, mount
// the explorer. The single trailing invocation is the module's entry point.
export class BundledHostBootstrap
{
    private static readonly RootId = "todl-app-root";

    public static async Main(): Promise<void>
    {
        if (typeof document === "undefined" || typeof window === "undefined") return; // no DOM (e.g. Node import)
        const root = document.getElementById(BundledHostBootstrap.RootId);
        const inlined = window.__TODL_PACKAGES__;
        if (root === null || inlined === undefined) return;
        const host = new BundledDomainHost(inlined.packages);
        await host.Compose(inlined.entry);
        new GraphExplorer(host.Query(), root).Render();
    }
}

void BundledHostBootstrap.Main();
