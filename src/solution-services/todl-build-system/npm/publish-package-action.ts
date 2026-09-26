import type { IBuildAction } from "../../build-system-core/build-action.js";
import type { ArtifactKey } from "../../build-system-core/artifact-key.js";
import { Severity } from "../../build-system-core/diagnostic-sink.js";
import { PackageRegistryClient } from "../../package-manager/package-registry-client.js";
import type { TodlBuildContext } from "../todl-build-context.js";

// The terminal action of the publish flavor: tars the staged package layout out of the
// Sandbox and pushes it to the registry threaded onto the context (spec: publish as a
// build action). A solution with no registry associated reports an error diagnostic and
// writes nothing — it never touches ctx.PublishRegistry, so the plain package flavor
// (which never appends this action) never triggers this path.
export class PublishPackageAction implements IBuildAction<TodlBuildContext>
{
    private static readonly ActionName = "publish-package";
    private static readonly NoRegistryMessage = "no registry associated with this solution";

    public readonly Name = PublishPackageAction.ActionName;
    public readonly Consumes: readonly ArtifactKey<unknown>[] = [];
    public readonly Produces: readonly ArtifactKey<unknown>[] = [];

    public async Execute(ctx: TodlBuildContext): Promise<void>
    {
        const registry = ctx.PublishRegistry;
        if (registry === undefined)
        {
            ctx.Diagnostics.Report({ severity: Severity.Error, message: PublishPackageAction.NoRegistryMessage, source: PublishPackageAction.ActionName });
            return;
        }

        const pkg = await PackageRegistryClient.PackStorage(ctx.Sandbox);
        await registry.Publish(pkg);
    }
}
