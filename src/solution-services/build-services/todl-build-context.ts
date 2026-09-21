import type { IStorage } from "@pragmatic-tech-ai/todl-runtime";
import type { CoreBuildContext } from "./build-action.js";
import type { BuildOptions } from "./build-options.js";
import type { IBuildProgress } from "./build-progress.js";
import type { ProjectManifest } from "../package-manager/manifest.js";
import type { IPackageSource } from "./package-source.js";

// The todl build context: the generic core context plus the two todl-specific channels
// the npm actions read — the project manifest (for identity + base bindings) and the
// package source the base resolver reads through.
export interface TodlBuildContext extends CoreBuildContext
{
    readonly Manifest: ProjectManifest;
    readonly Source: IPackageSource;
}

// A todl project build request — the todl-shaped inputs the facade accepts, carrying the
// manifest + package source alongside the framework inputs.
export interface TodlBuildRequest
{
    Project: IStorage;
    Manifest: ProjectManifest;
    BuildSystemId: string;
    Source: IPackageSource;
    Options?: BuildOptions;
    Progress?: IBuildProgress;
}
