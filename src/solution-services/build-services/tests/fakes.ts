import { FakeStorage, type IStorage } from "@pragmatic-tech-ai/todl-runtime";
import type { ArtifactKey } from "../artifact-key.js";
import type { IBuildAction, BuildActionContext } from "../build-action.js";
import type { IBuildSystem } from "../build-system.js";
import type { IBuildProgress } from "../build-progress.js";
import type { IBuildStorageProvider, OpenedOutput } from "../build-storage-provider.js";
import type { BuildOptions } from "../build-options.js";
import type { BuildDiagnostic } from "../diagnostic-sink.js";
import type { ActionStatus, ProjectBuildStatus, ProjectId } from "../build-result.js";
import type { IPackageSource, SourcedPackage } from "../package-source.js";
import { ProjectType, type ProjectManifest } from "../../package-manager/manifest.js";
import type { PackageRef } from "../../../publish/publish.js";

// A configurable action double: its behavior is an optional body run inside Execute,
// letting a test write to the sandbox, set artifacts, report diagnostics, or throw.
export interface FakeActionOptions
{
    name: string;
    consumes?: readonly ArtifactKey<unknown>[];
    produces?: readonly ArtifactKey<unknown>[];
    body?: (ctx: BuildActionContext) => Promise<void>;
}

export class FakeAction implements IBuildAction
{
    public readonly Name: string;
    public readonly Consumes: readonly ArtifactKey<unknown>[];
    public readonly Produces: readonly ArtifactKey<unknown>[];
    private readonly body: ((ctx: BuildActionContext) => Promise<void>) | undefined;

    constructor(options: FakeActionOptions)
    {
        this.Name = options.name;
        this.Consumes = options.consumes ?? [];
        this.Produces = options.produces ?? [];
        this.body = options.body;
    }

    public async Execute(ctx: BuildActionContext): Promise<void>
    {
        if (this.body !== undefined) await this.body(ctx);
    }
}

export class FakeSystem implements IBuildSystem
{
    constructor(
        public readonly Id: string,
        public readonly OutputName: string,
        private readonly actions: readonly IBuildAction[],
        private readonly appliesTo: ProjectType | undefined = undefined,
    )
    {
    }

    public get DisplayName(): string
    {
        return this.Id;
    }

    public AppliesTo(manifest: ProjectManifest): boolean
    {
        return this.appliesTo === undefined || manifest.type === this.appliesTo;
    }

    public Actions(): readonly IBuildAction[]
    {
        return this.actions;
    }
}

// Hands out fresh FakeStorages, and remembers what it created / deleted / opened so a
// test can assert sandbox disposal and inspect the output. OpenOutput returns a clean
// output storage (the provider owns clean-output + root precedence).
export class FakeStorageProvider implements IBuildStorageProvider
{
    public readonly Sandboxes: IStorage[] = [];
    public readonly Deleted: IStorage[] = [];
    public readonly Output = new FakeStorage();
    public OutputRoot = "/build";

    public CreateSandbox(): Promise<IStorage>
    {
        const sandbox = new FakeStorage();
        this.Sandboxes.push(sandbox);
        return Promise.resolve(sandbox);
    }

    public DeleteSandbox(sandbox: IStorage): Promise<void>
    {
        this.Deleted.push(sandbox);
        return Promise.resolve();
    }

    public OpenOutput(outputName: string, _options: BuildOptions): Promise<OpenedOutput>
    {
        return Promise.resolve({ Storage: this.Output, Path: `${this.OutputRoot}/${outputName}` });
    }
}

// Records progress milestones as strings for order-sensitive assertions.
export class RecordingProgress implements IBuildProgress
{
    public readonly Events: string[] = [];

    public SolutionStarted(order: readonly ProjectId[]): void
    {
        this.Events.push(`solution:${order.join(",")}`);
    }

    public ProjectStarted(id: ProjectId, actions: readonly string[]): void
    {
        this.Events.push(`project-start:${id}:${actions.join(",")}`);
    }

    public ActionStarted(_project: ProjectId, action: string): void
    {
        this.Events.push(`action-start:${action}`);
    }

    public ActionFinished(_project: ProjectId, action: string, status: ActionStatus): void
    {
        this.Events.push(`action-finish:${action}:${status}`);
    }

    public ProjectFinished(id: ProjectId, status: ProjectBuildStatus): void
    {
        this.Events.push(`project-finish:${id}:${status}`);
    }

    public Diagnostic(_project: ProjectId, diagnostic: BuildDiagnostic): void
    {
        this.Events.push(`diag:${diagnostic.severity}:${diagnostic.message}`);
    }
}

export class EmptyPackageSource implements IPackageSource
{
    public TryGet(_ref: PackageRef): Promise<SourcedPackage | undefined>
    {
        return Promise.resolve(undefined);
    }
}

export function libraryManifest(): ProjectManifest
{
    return { type: ProjectType.Library, name: "demo-lib", version: 1, id: "demo-lib" };
}
