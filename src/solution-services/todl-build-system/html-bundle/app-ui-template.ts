import { AppNaming } from "../../project-services/generators/app-naming.js";

// Builds `src/app.mu`: the tiny Application scaffold written once at project
// creation (AppGenerator, project-services/generators/). The root ContentPresenter
// (`x:root`) resolves the model's app view-model via `$service(<AppClass>)`, and the
// implicit (key-less) DataTemplate keyed on that class renders it. `<AppClass>` is
// AppNaming.AppClass(identity) — the same class src/main.ts exports. The file is
// user-owned from here on, so it carries an authored header, not a regenerable marker.
export class AppUiTemplate
{
    private static readonly ClassPlaceholder = "__APP_CLASS__";

    /** First line of the pristine scaffold — the marker the UI generation service
     *  uses to detect a never-yet-wired `src/app.mu` before it rewrites the app root. */
    public static readonly PristineMarker = "// src/app.mu — your application UI. Edit freely; it is never regenerated.";

    private static readonly Template = [
        AppUiTemplate.PristineMarker,
        "// The view-model class lives in ./main.ts; bind to its members with $Name.",
        "import __APP_CLASS__ from \"./main.js\"",
        "",
        "Application",
        "{",
        "    resources:",
        "    {",
        "        ContentPresenter x:root [ Content = $service(__APP_CLASS__) ]",
        "",
        "        DataTemplate [ DataType = __APP_CLASS__ ]",
        "        {",
        "            StackPanel [ Orientation = Vertical, Margin = (16,16,16,16) ]",
        "            {",
        "                TextBlock [ Text = $HelloText ]",
        "                TextBlock [ Text = $ConceptSummary ]",
        "            }",
        "        }",
        "    }",
        "}",
        "",
    ].join("\n");

    public static Render(identity: string): string
    {
        return AppUiTemplate.Template.split(AppUiTemplate.ClassPlaceholder).join(AppNaming.AppClass(identity));
    }
}
