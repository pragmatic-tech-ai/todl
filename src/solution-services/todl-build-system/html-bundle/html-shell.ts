// The single-page HTML template: a mount point, the inlined app payload on a window
// global, then the mural-host IIFE. All strings hoisted so the markup has one home.
export class HtmlShell
{
    private static readonly RootId = "todl-app-root";
    private static readonly AppGlobal = "__TODL_APP__";
    private static readonly Title = "TODL Graph";
    // Inline 1x1 transparent PNG so the browser never requests a separate /favicon.ico.
    private static readonly FaviconDataUri =
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    private static readonly FaviconLink = `<link rel="icon" href="${HtmlShell.FaviconDataUri}" />`;
    private static readonly PageStyle =
        "html, body { height: 100%; margin: 0; overflow: hidden; }\n"
        + `#${HtmlShell.RootId} { height: 100%; }`;

    public static Render(appJson: string, bundleJs: string): string
    {
        return HtmlShell.Page(`<script>window.${HtmlShell.AppGlobal} = ${appJson};</script>`, bundleJs);
    }

    /** Payload-free page for a remote app: the bundle fetches its data live, nothing is inlined. */
    public static RenderRemote(bundleJs: string): string
    {
        return HtmlShell.Page(undefined, bundleJs);
    }

    private static Page(payloadScript: string | undefined, bundleJs: string): string
    {
        return [
            "<!doctype html>",
            "<html lang=\"en\">",
            "<head>",
            "<meta charset=\"utf-8\" />",
            HtmlShell.FaviconLink,
            `<title>${HtmlShell.Title}</title>`,
            `<style>${HtmlShell.PageStyle}</style>`,
            "</head>",
            "<body>",
            `<div id="${HtmlShell.RootId}"></div>`,
            ...(payloadScript === undefined ? [] : [payloadScript]),
            `<script>${bundleJs}</script>`,
            "</body>",
            "</html>",
            "",
        ].join("\n");
    }
}
