// The single-page HTML template: a mount point, the inlined package set on a window
// global, then the graph-app IIFE. All strings hoisted so the markup has one home.
export class HtmlShell
{
    private static readonly RootId = "todl-app-root";
    private static readonly PackagesGlobal = "__TODL_PACKAGES__";
    private static readonly Title = "TODL Graph";

    public static Render(packagesJson: string, bundleJs: string): string
    {
        return [
            "<!doctype html>",
            "<html lang=\"en\">",
            "<head>",
            "<meta charset=\"utf-8\" />",
            `<title>${HtmlShell.Title}</title>`,
            "</head>",
            "<body>",
            `<div id="${HtmlShell.RootId}"></div>`,
            `<script>window.${HtmlShell.PackagesGlobal} = ${packagesJson};</script>`,
            `<script>${bundleJs}</script>`,
            "</body>",
            "</html>",
            "",
        ].join("\n");
    }
}
