/**
 * Core vocabulary for the project content generators subsystem: the trigger and
 * write-policy enums, the compile seam a generator sees the project through
 * (`IProjectModelProvider`), and the generator contract itself. A concrete
 * `IProjectModelProvider` implementation arrives in a later task; here it is
 * just the shape callers and generators agree on.
 */

import type { IStorage } from "@pragmatic-tech-ai/todl-runtime";
import type { DiagnosticSink } from "../../build-system-core/diagnostic-sink.js";
import type { ProjectManifest } from "../../package-manager/manifest.js";
import type { CompileOutcome } from "../../../publish/publish.js";

/** Why a generator run was requested. */
export enum GeneratorTrigger
{
    ProjectCreated,
    ReferencesChanged,
    OnDemand,
}

/** How a generator's output interacts with content already on disk. */
export enum WritePolicy
{
    Overwrite,
    WriteOnce,
    PreserveHandEdits,
}

/**
 * The shared compile seam a generator uses to read the project's compiled model.
 * Reuses publish's `CompileOutcome` ({ ok, diagnostics, errors, package? }) —
 * generators do not get a bespoke result type.
 */
export interface IProjectModelProvider
{
    Compile(): Promise<CompileOutcome>;
}

/** Everything a generator needs to produce its content for one run. */
export interface GeneratorContext
{
    readonly Project: IStorage;
    readonly Manifest: ProjectManifest;
    readonly Model: IProjectModelProvider;
    readonly Diagnostics: DiagnosticSink;
    readonly Reason: GeneratorTrigger;
}

/** The outcome of one generator run: which owned paths were written vs skipped. */
export interface GeneratorResult
{
    readonly Written: readonly string[];
    readonly Skipped: readonly string[];
}

/** A pluggable producer of generated project content. */
export interface IProjectContentGenerator
{
    readonly Id: string;
    readonly DisplayName: string;
    /** Project-relative paths this generator owns. */
    readonly Produces: readonly string[];
    readonly Triggers: readonly GeneratorTrigger[];
    readonly WritePolicy: WritePolicy;
    Generate(ctx: GeneratorContext): Promise<GeneratorResult>;
}
