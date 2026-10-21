import { ServiceKey } from "@pragmatic-tech-ai/todl-runtime";
import type { StagedFile } from "./bundler.js";
import type { BuildDiagnostic } from "./diagnostic-sink.js";
import type { CanonicalCompilerOptions } from "./compiler-options.js";

// The whole program to type-check: the project's staged .ts/.tsx/.d.ts files plus
// the canonical options. Plain-serializable so the seam can cross IPC (renderer
// build -> main tsc), exactly like BundleAppRequest.
export interface TypeCheckRequest
{
    Files: readonly StagedFile[];
    Options: CanonicalCompilerOptions;
}

export interface TypeCheckResult
{
    Diagnostics: readonly BuildDiagnostic[];
}

// The node-only type checker (tsc). The html-bundle build resolves it from the
// container so TypeCheckAction stays browser-safe.
export interface ITypeChecker
{
    Check(request: TypeCheckRequest): Promise<TypeCheckResult>;
}

export const TypeCheckerKey = new ServiceKey<ITypeChecker>("TypeChecker");
