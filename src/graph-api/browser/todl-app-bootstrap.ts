import { Application, type ApplicationInitOptions } from "@pragmatic-tech-ai/mural";
import { Pragmatic, PragmaticLight, PragmaticDark } from "@pragmatic-tech-ai/mural/resources/pragmatic";
import { HtmlTarget } from "@pragmatic-tech-ai/mural/visual-engine";

// A model whose data arrives asynchronously (a remote tenant): the bootstrap awaits
// its initial fetch before the app mounts. ModelDataSource.Prepare satisfies this.
export interface IPreparableModel
{
    Prepare(services: Application["Services"]): Promise<void>;
}

// Thin, reusable bootstrap for a compiled per-project TODL app (spec
// §per-project-app-build, task 4): resolves the page's host element and mounts
// the given `app` (the compiled app.mu's exported Application instance) onto it
// with the Pragmatic theme and a caller-supplied DataContext. Carries NO view
// knowledge — the view lives in the project's compiled app.mu; this class only
// wires host + theme + data. Node/no-DOM guard keeps the generated entry.ts
// inert outside a browser.
export class TodlAppBootstrap
{
    private static readonly RootId = "todl-app-root";
    private static readonly PrepareFailedMessage = "The app could not load its data. Check the connection and reload.";

    private static readonly ThemeOptions: ApplicationInitOptions =
    {
        theme: Pragmatic,
        autoScheme: { light: PragmaticLight, dark: PragmaticDark },
    };

    public static Mount(app: Application, dataContext: unknown): void
    {
        if (typeof document === "undefined" || typeof window === "undefined") return; // no DOM (e.g. Node import)
        const host = document.getElementById(TodlAppBootstrap.RootId);
        if (host === null) return;
        app.initialize(new HtmlTarget(host), { ...TodlAppBootstrap.ThemeOptions, dataContext });
    }

    /**
     * Async variant of Mount for remote-data apps: awaits the model's initial live
     * fetch, runs `beforeMount` (the entry constructs the view-model here, once the
     * data it reads exists), then mounts with the model as DataContext. On a failed
     * fetch it shows a generic message in the host element (never the error detail,
     * which may carry connection information) and rethrows.
     */
    public static async PrepareAndMount(app: Application, model: IPreparableModel, beforeMount?: () => void): Promise<void>
    {
        try
        {
            await model.Prepare(app.Services);
        }
        catch (error)
        {
            if (typeof document !== "undefined")
            {
                const host = document.getElementById(TodlAppBootstrap.RootId);
                if (host !== null) host.textContent = TodlAppBootstrap.PrepareFailedMessage;
            }
            throw error;
        }
        beforeMount?.();
        TodlAppBootstrap.Mount(app, model);
    }
}
