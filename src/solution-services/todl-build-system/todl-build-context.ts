import type { IStorage } from "@pragmatic-tech-ai/todl-runtime";
import type { CoreBuildContext } from "../build-system-core/build-action.js";
import type { BuildOptions } from "../build-system-core/build-options.js";
import type { IBuildProgress } from "../build-system-core/build-progress.js";
import type { ProjectManifest } from "../package-manager/manifest.js";
import type { IPackageRegistry } from "../package-manager/engine/package-registry.js";
import type { IPackageSource } from "./package-source.js";

// The todl build context: the generic core context plus the todl-specific channels the
// npm actions read — the project manifest (for identity + base bindings), the package
// source the base resolver reads through, and the optional publish registry a terminal
// publish action pushes the staged package to (threaded from the request; undefined when
// no registry is associated with the solution).
export interface TodlBuildContext extends CoreBuildContext
{
    readonly Manifest: ProjectManifest;
    readonly Source: IPackageSource;
    readonly PublishRegistry?: IPackageRegistry;
}

// A todl project build request — the todl-shaped inputs the facade accepts, carrying the
// manifest + package source alongside the framework inputs.
export interface TodlBuildRequest
{
    Project: IStorage;
    Manifest: ProjectManifest;
    BuildSystemId: string;
    BuildFlavorId?: string;
    Source: IPackageSource;
    Options?: BuildOptions;
    Progress?: IBuildProgress;
    PublishRegistry?: IPackageRegistry;
}
