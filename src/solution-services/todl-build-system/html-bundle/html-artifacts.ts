import { ArtifactKey } from "../../build-system-core/artifact-key.js";

// The typed artifacts the html-bundle build actions hand between each other. Static
// members so the produce/consume sites share one key identity.
export class HtmlArtifacts
{
    public static readonly CompiledUi = new ArtifactKey<readonly string[]>("CompiledUi");
    public static readonly AppEntry = new ArtifactKey<string>("AppEntry");
    public static readonly AppBundle = new ArtifactKey<string>("AppBundle");
    // Bundle-relative paths of the theme font files EmitFontsAction wrote into the Sandbox, so
    // the remote host can list them in the servable manifest's assets (else a tenant deploys only
    // index.html and the served app 404s every font).
    public static readonly FontAssets = new ArtifactKey<readonly string[]>("FontAssets");
}
