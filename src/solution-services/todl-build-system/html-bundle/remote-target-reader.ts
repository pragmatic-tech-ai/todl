import type { TodlBuildContext } from "../todl-build-context.js";
import type { RemoteBuildTarget } from "../../build-system-core/build-options.js";
import { Severity } from "../../build-system-core/diagnostic-sink.js";

// Reads the remote-app target out of the build options, reporting a build error when
// it is absent or incomplete so a remote action never emits a half-configured app.
export class RemoteTargetReader
{
    private static readonly MissingMessage = "remote build requires Options.Remote with an AppName";

    public static Read(ctx: TodlBuildContext, source: string): RemoteBuildTarget | undefined
    {
        const remote = ctx.Options.Remote;
        if (remote === undefined || !remote.AppName)
        {
            ctx.Diagnostics.Report({ severity: Severity.Error, message: RemoteTargetReader.MissingMessage, source });
            return undefined;
        }
        return remote;
    }
}
