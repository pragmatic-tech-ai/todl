import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { HtmlShell } from "../html-shell.js";

class HtmlShellFaviconTest
{
    public static readonly LinkPrefix = "<link rel=\"icon\" href=\"data:image/png;base64,";
}

describe("HtmlShell favicon", () =>
{
    const headOf = (html: string): string => html.slice(html.indexOf("<head>"), html.indexOf("</head>"));

    test("RenderRemote head contains an inline favicon link", () =>
    {
        const head = headOf(HtmlShell.RenderRemote("/*bundle*/"));
        assert.ok(head.includes(HtmlShellFaviconTest.LinkPrefix));
    });

    test("Render head contains an inline favicon link", () =>
    {
        const head = headOf(HtmlShell.Render("{}", "/*bundle*/"));
        assert.ok(head.includes(HtmlShellFaviconTest.LinkPrefix));
    });
});
