// app.mu — the TODL app composition root (Plexus architecture, ViewerShell).
//
// An `Application` block compiles to `export const app`. The root is the
// framework ViewerShell carrying a custom template (@TodlAppShell): a header, a
// left navigation rail built from the modules' capabilities, and a titled side
// panel that hosts the active capability's service (NavigationService.
// ActiveService), rendered by DataTemplate[ServiceType].
//
// This is the bare shell scaffold: one placeholder Home capability. Real
// capabilities are added as modules, each contributing a rail entry + a service
// + its DataTemplate.
import Material from "@pragmatic-tech-ai/mural/resources/material"
import MaterialDark from "@pragmatic-tech-ai/mural/resources/material"

// Shared registry client (window.todl bridge wrapper) — a root service.
import RegistryClient from "./services/registry/registry-client.ts"

// Modules — each a `module NAME { … }` const contributing a rail capability.
import HomeModule from "./modules/home/home.module.mu"

// Shell chrome (custom ViewerShell template) + per-module view resources.
import AppShell from "./shell.resources.mu"
import HomeResources from "./modules/home/home.resources.mu"

Application [ Theme = Material, Scheme = MaterialDark ] {
    .services: {
        RegistryClient
    }

    .modules: {
        HomeModule
    }

    resources: {
        merge AppShell
        merge HomeResources

        // Local Template value wins over the framework's default ViewerShell
        // style, so the shell renders the rail + side-panel layout above.
        ViewerShell x:root [ Template = @TodlAppShell ] { }
    }
}
