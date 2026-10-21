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

// A binary file the bundler emits ALONGSIDE the JS bundle, bundle-root-relative, carried as
// base64 so the result stays plain-serializable across the IPC seam. The html-bundle build uses
// this for the theme's font woff2s (resolved from the mural package on disk — reachable only
// from the node-side bundler), which the served app fetches by relative url.
export interface BundleAsset
{
    Path: string;
    Base64: string;
}

export interface BundleAppResult
{
    Text?: string;
    Assets?: readonly BundleAsset[];
    Diagnostics: readonly BuildDiagnostic[];
}

// The node-only app bundler (esbuild). The html-bundle build resolves it from the
// container so BundleAppAction itself stays browser-safe.
export interface IBundler
{
    BundleApp(request: BundleAppRequest): Promise<BundleAppResult>;
}

export const BundlerKey = new ServiceKey<IBundler>("Bundler");
