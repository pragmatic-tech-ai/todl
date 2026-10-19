/**
 * Emits `src/ui/<Class>/list.mu`: a ListBox over `$Items` with a row template
 * showing the concept's scalar fields, selection bound to `$Selected`, and a New button.
 */

import { WritePolicy, type GeneratorResult } from "./project-content-generator.js";
import { ConceptUiGeneratorSupport, type ConceptGeneratorContext, type IConceptUiGenerator } from "./concept-ui-generator.js";
import type { ConceptUiModel } from "./concept-ui-model.js";

export class ConceptListViewGenerator implements IConceptUiGenerator
{
    private static readonly GeneratorId = "concept-list-view";
    private static readonly PathTemplate = "src/ui/{0}/list.mu";
    private static readonly Placeholder = "{0}";
    private static readonly ImportsToken = "{imports}";
    private static readonly ClassToken = "{class}";
    private static readonly RowsToken = "{rows}";
    private static readonly ImportTemplate = "import {0}VM from \"./{0}-vm.mjs\"";
    private static readonly Newline = "\n";
    private static readonly RowIndent = "                ";
    private static readonly RowTextTemplate = "TextBlock [ Text = ${0}, Margin = (0,0,12,0) ]";
    private static readonly Template =
        "{imports}\n\n" +
        "StackPanel [ Orientation = Vertical ] {\n" +
        "    Button [ Command = $NewCommand ] {\n" +
        "        TextBlock [ Text = \"New\" ]\n" +
        "    }\n" +
        "    ListBox [ ItemsSource = $Items, SelectedItem = $Selected ] {\n" +
        "        ItemTemplate: DataTemplate [ DataType = {class}VM ] {\n" +
        "            StackPanel [ Orientation = Horizontal ] {\n" +
        "{rows}\n" +
        "            }\n" +
        "        }\n" +
        "    }\n" +
        "}\n";

    public readonly Id = ConceptListViewGenerator.GeneratorId;
    public readonly WritePolicy = WritePolicy.WriteOnce;

    public async Generate(ctx: ConceptGeneratorContext): Promise<GeneratorResult>
    {
        const ui = await ConceptUiGeneratorSupport.LoadModel(ctx);
        const path = ConceptListViewGenerator.PathTemplate.replace(ConceptListViewGenerator.Placeholder, ui.ClassName);
        return ConceptUiGeneratorSupport.WriteOne(ctx, path, this.Render(ui), this.WritePolicy);
    }

    public Render(ui: ConceptUiModel): string
    {
        const ph = ConceptListViewGenerator.Placeholder;
        const rows = ui.Fields
            .map(f => ConceptListViewGenerator.RowIndent + ConceptListViewGenerator.RowTextTemplate.replace(ph, f.BindingName))
            .join(ConceptListViewGenerator.Newline);
        const imports = ConceptListViewGenerator.ImportTemplate.replaceAll(ph, ui.ClassName);
        return ConceptListViewGenerator.Template
            .replace(ConceptListViewGenerator.ImportsToken, imports)
            .replaceAll(ConceptListViewGenerator.ClassToken, ui.ClassName)
            .replace(ConceptListViewGenerator.RowsToken, rows);
    }
}
