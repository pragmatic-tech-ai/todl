import type { IStorage } from "@pragmatic-tech-ai/todl-runtime";
import type { BuildOptions } from "./build-options.js";

// The manager's storage seam. It provisions a fresh sandbox per build, opens the
// kept output for a build system's OutputName, and disposes the sandbox afterwards.
// Output-root precedence (override -> solution setting -> default <project>/build/)
// is a host concern the production provider owns; the framework stays path-agnostic.
// Tests supply FakeStorages.
export interface OpenedOutput
{
    Storage: IStorage;
    /** The display path the report records as OutputPath. */
    Path: string;
}

export interface IBuildStorageProvider
{
    CreateSandbox(): Promise<IStorage>;
    DeleteSandbox(sandbox: IStorage): Promise<void>;
    OpenOutput(outputName: string, options: BuildOptions): Promise<OpenedOutput>;
}
