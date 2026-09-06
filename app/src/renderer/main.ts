// Renderer bootstrap — a thin entry (mural convention: bootstraps stay thin).
// `app` is the initialized Application compiled from app.mu; handing it an
// HtmlTarget mounts the EditorShell into #app.
// @ts-expect-error compiled by vitePluginMural
import { app } from "./app.mu";
import { HtmlTarget } from "@pragmatic-tech-ai/mural/visual-engine";
import { ContentHostService, NavigationService, RailAction, type DocumentsContentHostService } from "@pragmatic-tech-ai/mural/framework";
import { RelayCommand } from "@pragmatic-tech-ai/mural/runtime";
import { initTodlEditor } from "./editor/todl-editor.js";
import { PlaygroundDocument } from "./modules/playground/playground-document.js";

// Register the TODL Monaco language + start the language-server Web Worker before
// the playground's editor mounts.
initTodlEditor();

await document.fonts.ready;
app.initialize(new HtmlTarget(document.getElementById("app")!));

// The content region is a root-registered DocumentsContentHostService (app.mu).
const host = app.Services.getRequired(ContentHostService.Key) as DocumentsContentHostService;
// Seed a blank playground as the initial content.
host.Open(PlaygroundDocument.blank());

// Pin the "New Playground" rail header action. ShellModule has no rail-action
// field, so — like Plexus pins its status-bar controls — it's wired here.
const nav = app.Services.getRequired(NavigationService.Key);
nav.HeaderActions.Add(new RailAction(undefined, new RelayCommand(() => host.Open(PlaygroundDocument.blank())), "New Playground"));
