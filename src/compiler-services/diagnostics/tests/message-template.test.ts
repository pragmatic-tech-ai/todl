import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { MessageTemplate, MessageTemplateError } from "../message-template.js";

class MessageTemplateFx
{
    public static readonly Template = "\"{0}\" of \"{1}\" ({0})";
    public static readonly First = "a";
    public static readonly Second = "b";
    public static readonly Filled = "\"a\" of \"b\" (a)";
    public static readonly MissingSlot = "1";
}

describe("MessageTemplate", () =>
{
    test("fills every placeholder, repeated ones included", () =>
    {
        assert.equal(MessageTemplate.Format(MessageTemplateFx.Template, MessageTemplateFx.First, MessageTemplateFx.Second), MessageTemplateFx.Filled);
    });

    test("a placeholder with no argument throws MessageTemplateError naming the template and the slot", () =>
    {
        assert.throws(() => MessageTemplate.Format(MessageTemplateFx.Template, MessageTemplateFx.First), (error: unknown) =>
            error instanceof MessageTemplateError
            && error.message.includes(MessageTemplateFx.Template) && error.message.includes(MessageTemplateFx.MissingSlot));
    });
});
