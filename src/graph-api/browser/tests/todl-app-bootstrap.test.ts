import { test } from "node:test";
import assert from "node:assert/strict";
import type { Application, ApplicationInitOptions, MountableTarget } from "@pragmatic-tech-ai/mural";
import { HtmlTarget } from "@pragmatic-tech-ai/mural/visual-engine";
import { TodlAppBootstrap } from "../todl-app-bootstrap.js";

// A minimal stand-in for a mural `Application`: records every `initialize`
// call and mimics the one behaviour Mount relies on (DataContext proxies to
// the root once opts.dataContext is applied). Deliberately NOT a real
// mural Application — Mount's contract is exercised through this recorder.
class StubApplication
{
    public DataContext: unknown;
    public readonly InitializeCalls: Array<{ target: MountableTarget; opts: ApplicationInitOptions | undefined }> = [];

    public initialize(target: MountableTarget, opts?: ApplicationInitOptions): MountableTarget
    {
        this.InitializeCalls.push({ target, opts });
        if (opts?.dataContext !== undefined) this.DataContext = opts.dataContext;
        return target;
    }
}

// A tiny DOM emulation, just enough surface for a real `HtmlTarget` (mural's
// concrete PresentationTarget for the browser) to construct against without
// throwing — Mount constructs a real HtmlTarget, so the fake host has to
// behave like a real Element for that one constructor call. Nothing here
// simulates layout, painting, or events; it exists purely to prove Mount
// wires host + HtmlTarget + DataContext together.
class FakeStyle
{
    [key: string]: unknown;
}

class FakeElement
{
    public readonly localName: string;
    public readonly style: FakeStyle = new FakeStyle();
    public readonly children: FakeElement[] = [];
    public parentNode: FakeElement | null = null;
    public tabIndex = -1;
    private readonly attributes = new Map<string, string>();

    constructor(localName: string)
    {
        this.localName = localName;
    }

    public get ownerDocument(): FakeDocument
    {
        return Fixtures.Document;
    }

    public get firstChild(): FakeElement | null
    {
        return this.children[0] ?? null;
    }

    public appendChild(child: FakeElement): FakeElement
    {
        this.children.push(child);
        child.parentNode = this;
        return child;
    }

    public insertBefore(child: FakeElement, _ref: FakeElement | null): FakeElement
    {
        this.children.unshift(child);
        child.parentNode = this;
        return child;
    }

    public removeChild(child: FakeElement): void
    {
        const i = this.children.indexOf(child);
        if (i >= 0) this.children.splice(i, 1);
    }

    public querySelector(selector: string): FakeElement | null
    {
        return this.children.find((c) => c.localName === selector) ?? null;
    }

    public setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
    public getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
    public hasAttribute(name: string): boolean { return this.attributes.has(name); }
    public removeAttribute(name: string): void { this.attributes.delete(name); }

    public addEventListener(): void { /* no-op */ }
    public removeEventListener(): void { /* no-op */ }
    public focus(): void { /* no-op */ }

    public getBoundingClientRect(): { width: number; height: number; top: number; left: number }
    {
        return { width: 0, height: 0, top: 0, left: 0 };
    }
}

class FakeResizeObserver
{
    constructor(_callback: unknown) { /* no-op */ }
    public observe(): void { /* no-op */ }
    public disconnect(): void { /* no-op */ }
}

class FakeDocument
{
    public createElementNS(_ns: string, localName: string): FakeElement
    {
        return new FakeElement(localName);
    }

    public getElementById(id: string): FakeElement | null
    {
        return id === Fixtures.HostId ? Fixtures.Host : null;
    }
}

class Fixtures
{
    public static readonly HostId = "todl-app-root";
    public static readonly Document = new FakeDocument();
    public static readonly Host = new FakeElement("div");

    public static InstallDom(): void
    {
        (globalThis as unknown as { document: unknown }).document = Fixtures.Document;
        (globalThis as unknown as { window: unknown }).window = {};
        (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeResizeObserver;
    }

    public static UninstallDom(): void
    {
        delete (globalThis as unknown as { document?: unknown }).document;
        delete (globalThis as unknown as { window?: unknown }).window;
        delete (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver;
    }
}

test("Mount returns without touching the app when there is no DOM", () =>
{
    const app = new StubApplication();
    TodlAppBootstrap.Mount(app as unknown as Application, { some: "data" });
    assert.equal(app.InitializeCalls.length, 0);
});

test("Mount initializes against an HtmlTarget and threads the DataContext through when the host is present", () =>
{
    Fixtures.InstallDom();
    try
    {
        const app = new StubApplication();
        const dataContext = { hello: "world" };
        TodlAppBootstrap.Mount(app as unknown as Application, dataContext);

        assert.equal(app.InitializeCalls.length, 1);
        const call = app.InitializeCalls[0]!;
        assert.ok(call.target instanceof HtmlTarget, "expected the mount target to be an HtmlTarget");
        assert.equal(call.opts?.dataContext, dataContext);
        assert.equal(app.DataContext, dataContext);
    }
    finally
    {
        Fixtures.UninstallDom();
    }
});
