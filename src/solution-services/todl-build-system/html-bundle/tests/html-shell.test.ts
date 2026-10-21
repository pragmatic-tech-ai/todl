import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { HtmlShell } from "../html-shell.js";

class HtmlShellFaviconTest
{
    public static readonly LinkPrefix = "<link rel=\"icon\" type=\"image/png\" href=\"data:image/png;base64,";

    public static HeadOf(html: string): string
    {
        return html.slice(html.indexOf("<head>"), html.indexOf("</head>"));
    }
}

describe("HtmlShell favicon", () =>
{
    test("RenderRemote head contains an inline favicon link", () =>
    {
        const head = HtmlShellFaviconTest.HeadOf(HtmlShell.RenderRemote("/*bundle*/"));
        assert.ok(head.includes(HtmlShellFaviconTest.LinkPrefix));
    });

    test("Render head contains an inline favicon link", () =>
    {
        const head = HtmlShellFaviconTest.HeadOf(HtmlShell.Render("{}", "/*bundle*/"));
        assert.ok(head.includes(HtmlShellFaviconTest.LinkPrefix));
    });
});
