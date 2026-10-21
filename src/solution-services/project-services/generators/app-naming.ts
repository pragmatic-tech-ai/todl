import { pascalCase } from "../../../codegen/naming.js";

/**
 * The ONE source of the generated class names, so every generator and the
 * scaffolded imports agree. DtoClass MUST equal the name read-client emits for
 * the package class (pascalCase of the model name); AppClass is that + "App".
 */
export class AppNaming
{
    private static readonly AppSuffix = "App";
    private static readonly RowViewModelSuffix = "VM";
    private static readonly ListViewModelSuffix = "ListVM";
    private static readonly ListViewSuffix = "ListView";
    private static readonly FormViewSuffix = "FormView";
    private static readonly ListTemplateSuffix = "ListTemplate";
    private static readonly FormTemplateSuffix = "FormTemplate";

    public static DtoClass(modelName: string): string
    {
        return pascalCase(modelName);
    }

    public static AppClass(modelName: string): string
    {
        return `${AppNaming.DtoClass(modelName)}${AppNaming.AppSuffix}`;
    }

    /** The row/record view-model class a concept's list rows bind to (`<Class>VM`). */
    public static RowViewModel(className: string): string
    {
        return `${className}${AppNaming.RowViewModelSuffix}`;
    }

    /** The container view-model class the list + form DataContext is (`<Class>ListVM`). */
    public static ListViewModel(className: string): string
    {
        return `${className}${AppNaming.ListViewModelSuffix}`;
    }

    /** The ResourceDictionary class `list.mu` exports (`<Class>ListView`). */
    public static ListViewDictionary(className: string): string
    {
        return `${className}${AppNaming.ListViewSuffix}`;
    }

    /** The ResourceDictionary class `form.mu` exports (`<Class>FormView`). */
    public static FormViewDictionary(className: string): string
    {
        return `${className}${AppNaming.FormViewSuffix}`;
    }

    /** The `x:key` of the list DataTemplate inside `list.mu` (`<Class>ListTemplate`). */
    public static ListTemplateKey(className: string): string
    {
        return `${className}${AppNaming.ListTemplateSuffix}`;
    }

    /** The `x:key` of the form DataTemplate inside `form.mu` (`<Class>FormTemplate`). */
    public static FormTemplateKey(className: string): string
    {
        return `${className}${AppNaming.FormTemplateSuffix}`;
    }
}
