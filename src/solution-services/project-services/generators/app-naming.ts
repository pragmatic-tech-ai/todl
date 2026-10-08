import { pascalCase } from "../../../codegen/naming.js";

/**
 * The ONE source of the generated class names, so every generator and the
 * scaffolded imports agree. DtoClass MUST equal the name read-client emits for
 * the package class (pascalCase of the model name); AppClass is that + "App".
 */
export class AppNaming
{
    private static readonly AppSuffix = "App";

    public static DtoClass(modelName: string): string
    {
        return pascalCase(modelName);
    }

    public static AppClass(modelName: string): string
    {
        return `${AppNaming.DtoClass(modelName)}${AppNaming.AppSuffix}`;
    }
}
