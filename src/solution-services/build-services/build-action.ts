import type { IStorage } from "@pragmatic-tech-ai/todl-runtime";
import type { ArtifactKey } from "./artifact-key.js";
import type { BuildArtifacts } from "./build-artifacts.js";
import type { BuildOptions } from "./build-options.js";
import type { DiagnosticSink } from "./diagnostic-sink.js";

// The generic build context every action receives (spec §2.1). It carries only
// framework state — the project + sandbox storages, the typed artifact bag, options,
// and the diagnostic sink — and names no todl type. A host extends this with its own
// fields (todl adds Manifest + Source); an action declares the context type it needs
// via the C type parameter. An action writing into Project is a project content
// generator (persistent); one writing into Sandbox stages output for promotion.
export interface CoreBuildContext
{
    readonly Project: IStorage;
    readonly Sandbox: IStorage;
    readonly Artifacts: BuildArtifacts;
    readonly Options: BuildOptions;
    readonly Diagnostics: DiagnosticSink;
}

// The single unit of work (spec §2). A build system is an ordered list of these.
// Consumes/Produces declare the typed artifacts read/written (the manager validates
// consume-before-produce at registration); file I/O stays imperative for v1. C is the
// context type the action needs — defaulting to CoreBuildContext for a purely generic
// action.
export interface IBuildAction<C extends CoreBuildContext = CoreBuildContext>
{
    readonly Name: string;
    readonly Consumes: readonly ArtifactKey<unknown>[];
    readonly Produces: readonly ArtifactKey<unknown>[];
    Execute(ctx: C): Promise<void>;
}
