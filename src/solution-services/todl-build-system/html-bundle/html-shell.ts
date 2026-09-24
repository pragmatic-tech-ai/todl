// The single-page HTML template: a mount point, the inlined app payload on a window
// global, then the mural-host IIFE. All strings hoisted so the markup has one home.
export class HtmlShell
{
    private static readonly RootId = "todl-app-root";
    private static readonly AppGlobal = "__TODL_APP__";
    private static readonly Title = "TODL Graph";
    private static readonly PageStyle =
        "html, body { height: 100%; margin: 0; overflow: hidden; }\n"
        + `#${HtmlShell.RootId} { height: 100%; }`;

    public static Render(appJson: string, bundleJs: string): string
    {
        return [
            "<!doctype html>",
            "<html lang=\"en\">",
            "<head>",
            "<meta charset=\"utf-8\" />",
            `<title>${HtmlShell.Title}</title>`,
            `<style>${HtmlShell.PageStyle}</style>`,
            "</head>",
            "<body>",
            `<div id="${HtmlShell.RootId}"></div>`,
            `<script>window.${HtmlShell.AppGlobal} = ${appJson};</script>`,
            `<script>${bundleJs}</script>`,
            "</body>",
            "</html>",
            "",
        ].join("\n");
    }
}
