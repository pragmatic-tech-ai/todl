import { test } from "node:test";
import assert from "node:assert/strict";
import { MimeTypes } from "../mime-types.js";

test("MimeTypes.Of maps known extensions", () =>
{
    assert.equal(MimeTypes.Of("acme/1.0.0/resources/az.svg"), "image/svg+xml");
    assert.equal(MimeTypes.Of("x.png"), "image/png");
    assert.equal(MimeTypes.Of("wiki/readme.md"), "text/markdown");
});

test("MimeTypes.Of is case-insensitive on the extension", () =>
{
    assert.equal(MimeTypes.Of("LOGO.SVG"), "image/svg+xml");
});

test("MimeTypes.Of falls back for unknown or extensionless paths", () =>
{
    assert.equal(MimeTypes.Of("data.bin"), "application/octet-stream");
    assert.equal(MimeTypes.Of("noextension"), "application/octet-stream");
});
