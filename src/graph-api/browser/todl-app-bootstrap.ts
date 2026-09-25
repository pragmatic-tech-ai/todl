import { Application, type ApplicationInitOptions } from "@pragmatic-tech-ai/mural";
import { Material, MaterialLight, MaterialDark } from "@pragmatic-tech-ai/mural/resources/material";
import { HtmlTarget } from "@pragmatic-tech-ai/mural/visual-engine";

// Thin, reusable bootstrap for a compiled per-project TODL app (spec
// §per-project-app-build, task 4): resolves the page's host element and mounts
// the given `app` (the compiled app.mu's exported Application instance) onto it
// with the Material theme and a caller-supplied DataContext. Carries NO view
// knowledge — the view lives in the project's compiled app.mu; this class only
// wires host + theme + data. Node/no-DOM guard mirrors MuralBundledHost so the
// generated entry.ts stays inert outside a browser.
export class TodlAppBootstrap
{
    private static readonly RootId = "todl-app-root";

    private static readonly ThemeOptions: ApplicationInitOptions =
    {
        theme: Material,
        autoScheme: { light: MaterialLight, dark: MaterialDark },
    };

    public static Mount(app: Application, dataContext: unknown): void
    {
        if (typeof document === "undefined" || typeof window === "undefined") return; // no DOM (e.g. Node import)
        const host = document.getElementById(TodlAppBootstrap.RootId);
        if (host === null) return;
        app.initialize(new HtmlTarget(host), { ...TodlAppBootstrap.ThemeOptions, dataContext });
    }
}
