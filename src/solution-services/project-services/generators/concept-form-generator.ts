/**
 * Emits `src/ui/<Class>/form.mu`: a referenceable `resources <Class>FormView`
 * ResourceDictionary carrying one keyed DataTemplate (`x:key="<Class>FormTemplate"`,
 * `DataType = <Class>ListVM`) — one control per scalar field two-way bound to
 * `$Selected.<BindingName>`, plus Save and Delete buttons. The app root `merge`s this
 * dictionary and hosts the template by key, so the generated file stays the live,
 * editable source of the form view (not an inlined copy).
 */

import { WritePolicy, type GeneratorResult } from "./project-content-generator.js";
import { ConceptUiGeneratorSupport, type ConceptGeneratorContext, type IConceptUiGenerator } from "./concept-ui-generator.js";
import { UiFieldType, type ConceptUiModel, type UiField } from "./concept-ui-model.js";
import { AppNaming } from "./app-naming.js";

export class ConceptFormGenerator implements IConceptUiGenerator
{
    private static readonly GeneratorId = "concept-form";
    private static readonly PathTemplate = "src/ui/{0}/form.mu";
    private static readonly Placeholder = "{0}";
    private static readonly ClassFileToken = "{class}";
    private static readonly ListVmToken = "{listVm}";
    private static readonly DictionaryToken = "{dictionary}";
    private static readonly TemplateKeyToken = "{templateKey}";
    private static readonly FieldsToken = "{fields}";
    private static readonly Newline = "\n";
    private static readonly Indent = "            ";
    private static readonly LabelTemplate = "TextBlock [ Text = \"{0}\" ]";
    private static readonly TextBoxTemplate = "TextBox [ Text = $Selected.{0} ]";
    private static readonly CheckboxTemplate = "Checkbox [ IsChecked = $Selected.{0} ]";
    private static readonly Template =
        "import {listVm} from \"./{class}-vm.js\"\n\n" +
        "resources {dictionary} {\n" +
        "    DataTemplate x:key=\"{templateKey}\" [ DataType = {listVm} ] {\n" +
        "        StackPanel [ Orientation = Vertical ] {\n" +
        "{fields}\n" +
        "            Button [ Command = $SaveCommand ] {\n" +
        "                TextBlock [ Text = \"Save\" ]\n" +
        "            }\n" +
        "            Button [ Command = $DeleteCommand ] {\n" +
        "                TextBlock [ Text = \"Delete\" ]\n" +
        "            }\n" +
        "        }\n" +
        "    }\n" +
        "}\n";

    public readonly Id = ConceptFormGenerator.GeneratorId;
    public readonly WritePolicy = WritePolicy.WriteOnce;

    public async Generate(ctx: ConceptGeneratorContext): Promise<GeneratorResult>
    {
        const ui = await ConceptUiGeneratorSupport.LoadModel(ctx);
        const path = ConceptFormGenerator.PathTemplate.replace(ConceptFormGenerator.Placeholder, ui.ClassName);
        return ConceptUiGeneratorSupport.WriteOne(ctx, path, this.Render(ui), this.WritePolicy);
    }

    public Render(ui: ConceptUiModel): string
    {
        const fields = ui.Fields.map(f => this.RenderField(f)).join(ConceptFormGenerator.Newline);
        return ConceptFormGenerator.Template
            .split(ConceptFormGenerator.ClassFileToken).join(ui.ClassName)
            .split(ConceptFormGenerator.ListVmToken).join(AppNaming.ListViewModel(ui.ClassName))
            .split(ConceptFormGenerator.DictionaryToken).join(AppNaming.FormViewDictionary(ui.ClassName))
            .split(ConceptFormGenerator.TemplateKeyToken).join(AppNaming.FormTemplateKey(ui.ClassName))
            .replace(ConceptFormGenerator.FieldsToken, fields);
    }

    private RenderField(field: UiField): string
    {
        const ph = ConceptFormGenerator.Placeholder;
        const label = ConceptFormGenerator.LabelTemplate.replace(ph, field.Name);
        const control = field.Type === UiFieldType.Boolean
            ? ConceptFormGenerator.CheckboxTemplate.replace(ph, field.BindingName)
            : ConceptFormGenerator.TextBoxTemplate.replace(ph, field.BindingName);
        return ConceptFormGenerator.Indent + label + ConceptFormGenerator.Newline + ConceptFormGenerator.Indent + control;
    }
}
