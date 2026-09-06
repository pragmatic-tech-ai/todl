// app.mu — the TODL app composition root (Plexus architecture).
//
// An `Application` block compiles to `export const app`. The renderer bootstrap
// (main.ts) hands it an HtmlTarget to paint into. The root is the framework
// EditorShell; capabilities come from the modules listed in `.modules:`, and the
// document Content region is a root-registered DocumentsContentHostService.
import Material from "@pragmatic-tech-ai/mural/resources/material"
import MaterialDark from "@pragmatic-tech-ai/mural/resources/material"
// ContentHostService + DocumentsContentHostService are already in the compiler's
// default symbol table — importing them conflicts, so they're used unqualified.

// Shared registry client (window.todl bridge wrapper), resolved by the
// registry-facing services/documents.
import RegistryClient from "./services/registry/registry-client.ts"

// Modules — each a `module NAME { … }` const from its own file.
import PlaygroundModule from "./modules/playground/playground.module.mu"

// Per-module view resources, merged app-global here.
import PlaygroundResources from "./modules/playground/playground.resources.mu"
// Shared example-runner templates (DataTemplate[ExampleRunnerVM] + DiagnosticVM),
// which the playground's $Runner content resolves against. Merged at the app root
// (a nested merge inside PlaygroundResources does not flatten into scope).
import ExampleRunner from "./components/example-runner/example-runner.mu"

Application [ Theme = Material, Scheme = MaterialDark ] {
    .services: {
        // Shared window.todl bridge wrapper — registered by class token; services
        // resolve it via provider.getRequired(RegistryClient).
        RegistryClient
        // Content region host, root-registered so main.ts + modules resolve THIS
        // instance through the framework ContentHostService key (EditorShell would
        // otherwise register it shell-scoped, unreachable from root).
        DocumentsContentHostService -> ContentHostService
    }

    .modules: {
        PlaygroundModule
    }

    resources: {
        merge ExampleRunner
        merge PlaygroundResources

        // The app root — the framework EditorShell. Regions are data-driven
        // (NavigationService from the modules + the active document).
        EditorShell x:root { }
    }
}
