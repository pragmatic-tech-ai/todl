import { SettingDefinition, SettingKind } from "@pragmatic-tech-ai/mural/framework";
import { SettingBagDefinition } from "../solution-manager/engine/setting-bag-definition.js";
import type { SolutionSettingsRegistry } from "../solution-manager/engine/solution-settings-registry.js";

// The solution-scoped "build" setting bag todl-build-system contributes: the build
// output directory name and whether presentation bakes colored icons by default.
// Mirrors the ConnectionBag precedent — a static definition + an imperative contribute a
// host settings service calls (settings are contributed imperatively, not through a
// module block).
export class TodlBuildSettings
{
    private static readonly BagId = "build";
    private static readonly BagTitle = "Build";
    private static readonly OutputDirKey = "outputDir";
    private static readonly OutputDirLabel = "Output directory";
    private static readonly OutputDirDefault = "build";
    private static readonly ColoredKey = "coloredPresentation";
    private static readonly ColoredLabel = "Colored presentation icons";

    public static Definition(): SettingBagDefinition
    {
        return new SettingBagDefinition(TodlBuildSettings.BagId, TodlBuildSettings.BagTitle, [
            TodlBuildSettings.StringField(TodlBuildSettings.OutputDirKey, TodlBuildSettings.OutputDirLabel, TodlBuildSettings.OutputDirDefault),
            TodlBuildSettings.BooleanField(TodlBuildSettings.ColoredKey, TodlBuildSettings.ColoredLabel, true),
        ]);
    }

    public static Contribute(registry: SolutionSettingsRegistry): void
    {
        registry.Contribute(TodlBuildSettings.Definition());
    }

    private static StringField(key: string, label: string, def: string): SettingDefinition
    {
        const d = new SettingDefinition();
        d.Key = key;
        d.Label = label;
        d.Category = TodlBuildSettings.BagTitle;
        d.Default = def;
        d.Kind = SettingKind.String;
        return d;
    }

    private static BooleanField(key: string, label: string, def: boolean): SettingDefinition
    {
        const d = new SettingDefinition();
        d.Key = key;
        d.Label = label;
        d.Category = TodlBuildSettings.BagTitle;
        d.Default = def;
        d.Kind = SettingKind.Boolean;
        return d;
    }
}
