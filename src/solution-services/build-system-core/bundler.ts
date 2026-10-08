import { ServiceKey } from "@pragmatic-tech-ai/todl-runtime";
import type { BuildDiagnostic } from "./diagnostic-sink.js";

// A single staged source file handed to the bundler, POSIX-relative to the app root.
export interface StagedFile
{
    Path: string;
    Text: string;
}

// The whole app to bundle: the entry module path plus every staged file (generated
// tree + compiled UI + entry glue). Plain-serializable so the seam can cross IPC.
export interface BundleAppRequest
{
    Entry: string;
    Files: readonly StagedFile[];
}

export interface BundleAppResult
{
    Text?: string;
    Diagnostics: readonly BuildDiagnostic[];
}

// The node-only app bundler (esbuild). The html-bundle build resolves it from the
// container so BundleAppAction itself stays browser-safe.
export interface IBundler
{
    BundleApp(request: BundleAppRequest): Promise<BundleAppResult>;
}

export const BundlerKey = new ServiceKey<IBundler>("Bundler");
