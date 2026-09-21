import type { IStorage } from "@pragmatic-tech-ai/todl-runtime";
import type { ProjectManifest } from "../package-manager/manifest.js";
import type { ArtifactKey } from "./artifact-key.js";
import type { BuildArtifacts } from "./build-artifacts.js";
import type { BuildOptions } from "./build-options.js";
import type { DiagnosticSink } from "./diagnostic-sink.js";
import type { IPackageSource } from "./package-source.js";

// What every action receives (spec §2.1). An action writing into Project is a
// project content generator (persistent); one writing into Sandbox stages output for
// promotion. Expected failures are reported to Diagnostics; the bag carries hot
// values, but an action must be correct reading only files.
export interface BuildActionContext
{
    readonly Project: IStorage;
    readonly Sandbox: IStorage;
    readonly Artifacts: BuildArtifacts;
    readonly Source: IPackageSource;
    readonly Manifest: ProjectManifest;
    readonly Options: BuildOptions;
    readonly Diagnostics: DiagnosticSink;
}

// The single unit of work (spec §2). A build system is an ordered list of these.
// Consumes/Produces declare the typed artifacts read/written (the manager validates
// consume-before-produce at registration); file I/O stays imperative for v1.
export interface IBuildAction
{
    readonly Name: string;
    readonly Consumes: readonly ArtifactKey<unknown>[];
    readonly Produces: readonly ArtifactKey<unknown>[];
    Execute(ctx: BuildActionContext): Promise<void>;
}
