import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { HtmlShell } from "../html-shell.js";

describe("HtmlShell favicon", () =>
{
    const headOf = (html: string): string => html.slice(html.indexOf("<head>"), html.indexOf("</head>"));

    test("RenderRemote head contains an inline favicon link", () =>
    {
        const head = headOf(HtmlShell.RenderRemote("/*bundle*/"));
        assert.ok(head.includes("<link rel=\"icon\""));
        assert.ok(head.includes("href=\"data:"));
    });

    test("Render head contains an inline favicon link", () =>
    {
        const head = headOf(HtmlShell.Render("{}", "/*bundle*/"));
        assert.ok(head.includes("<link rel=\"icon\""));
        assert.ok(head.includes("href=\"data:"));
    });
});
