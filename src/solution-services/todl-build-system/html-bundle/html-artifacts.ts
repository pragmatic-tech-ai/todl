import { ArtifactKey } from "../../build-system-core/artifact-key.js";

// The typed artifacts the html-bundle build actions hand between each other. Static
// members so the produce/consume sites share one key identity.
export class HtmlArtifacts
{
    public static readonly GeneratedDto = new ArtifactKey<string>("GeneratedDto");
    public static readonly CompiledUi = new ArtifactKey<readonly string[]>("CompiledUi");
    public static readonly AppEntry = new ArtifactKey<string>("AppEntry");
    public static readonly AppBundle = new ArtifactKey<string>("AppBundle");
}
