/**
 * Emits `src/ui/<Class>/list.mu`: a referenceable `resources <Class>ListView`
 * ResourceDictionary carrying one keyed DataTemplate (`x:key="<Class>ListTemplate"`,
 * `DataType = <Class>ListVM`) — a ListBox over `$Items` with a row template showing
 * the concept's scalar fields, selection bound to `$Selected`, and a New button. The
 * app root `merge`s this dictionary and hosts the template by key, so the generated
 * file stays the live, editable source of the list view (not an inlined copy).
 */

import { WritePolicy, type GeneratorResult } from "./project-content-generator.js";
import { ConceptUiGeneratorSupport, type ConceptGeneratorContext, type IConceptUiGenerator } from "./concept-ui-generator.js";
import type { ConceptUiModel } from "./concept-ui-model.js";
import { AppNaming } from "./app-naming.js";

export class ConceptListViewGenerator implements IConceptUiGenerator
{
    private static readonly GeneratorId = "concept-list-view";
    private static readonly PathTemplate = "src/ui/{0}/list.mu";
    private static readonly Placeholder = "{0}";
    private static readonly ClassFileToken = "{class}";
    private static readonly RowVmToken = "{rowVm}";
    private static readonly ListVmToken = "{listVm}";
    private static readonly DictionaryToken = "{dictionary}";
    private static readonly TemplateKeyToken = "{templateKey}";
    private static readonly RowsToken = "{rows}";
    private static readonly Newline = "\n";
    private static readonly RowIndent = "                        ";
    private static readonly RowTextTemplate = "TextBlock [ Text = ${0}, Margin = (0,0,12,0) ]";
    private static readonly Template =
        "import {rowVm} from \"./{class}-vm.js\"\n" +
        "import {listVm} from \"./{class}-vm.js\"\n\n" +
        "resources {dictionary} {\n" +
        "    DataTemplate x:key=\"{templateKey}\" [ DataType = {listVm} ] {\n" +
        "        StackPanel [ Orientation = Vertical ] {\n" +
        "            Button [ Command = $NewCommand ] {\n" +
        "                TextBlock [ Text = \"New\" ]\n" +
        "            }\n" +
        "            ListBox [ ItemsSource = $Items, SelectedItem = $Selected ] {\n" +
        "                ItemTemplate: DataTemplate [ DataType = {rowVm} ] {\n" +
        "                    StackPanel [ Orientation = Horizontal ] {\n" +
        "{rows}\n" +
        "                    }\n" +
        "                }\n" +
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
        return ConceptListViewGenerator.Template
            .split(ConceptListViewGenerator.ClassFileToken).join(ui.ClassName)
            .split(ConceptListViewGenerator.RowVmToken).join(AppNaming.RowViewModel(ui.ClassName))
            .split(ConceptListViewGenerator.ListVmToken).join(AppNaming.ListViewModel(ui.ClassName))
            .split(ConceptListViewGenerator.DictionaryToken).join(AppNaming.ListViewDictionary(ui.ClassName))
            .split(ConceptListViewGenerator.TemplateKeyToken).join(AppNaming.ListTemplateKey(ui.ClassName))
            .replace(ConceptListViewGenerator.RowsToken, rows);
    }
}
