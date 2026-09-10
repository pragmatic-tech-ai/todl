import { SettingDefinition, SettingKind } from "@pragmatic-tech-ai/mural/framework";
import { ObservableCollection } from "@pragmatic-tech-ai/mural/runtime";
import { SettingBagDefinition, SolutionSettingsRegistry } from "@pragmatic-tech-ai/todl";
import { NPM_REGISTRY_BAG_ID, NPM_REGISTRY_BAG_TITLE, NPM_REGISTRY_FIELDS, type NpmFieldSpec } from "./npm-registry-fields.js";

// The TODL app's cross-project setting bag: the NPM registry configuration a
// solution shares across its member packages. Built from the pure NPM_REGISTRY_FIELDS
// specs (see that module for the security note — no literal token, ever).
export class NpmRegistryBag {
    static readonly Id = NPM_REGISTRY_BAG_ID;

    static definition(): SettingBagDefinition {
        return new SettingBagDefinition(
            NPM_REGISTRY_BAG_ID,
            NPM_REGISTRY_BAG_TITLE,
            NPM_REGISTRY_FIELDS.map((f) => NpmRegistryBag.toDefinition(f)),
        );
    }

    static contribute(registry: SolutionSettingsRegistry): void {
        registry.Contribute(NpmRegistryBag.definition());
    }

    private static toDefinition(spec: NpmFieldSpec): SettingDefinition {
        const d = new SettingDefinition();
        d.Key = spec.key;
        d.Label = spec.label;
        d.Category = NPM_REGISTRY_BAG_TITLE;
        d.Default = spec.default;
        d.Kind = spec.kind === "choice" ? SettingKind.Choice : SettingKind.String;
        if (spec.choices !== undefined) {
            const choices = new ObservableCollection<string>();
            for (const c of spec.choices) choices.Add(c);
            d.Choices = choices;
        }
        return d;
    }
}
