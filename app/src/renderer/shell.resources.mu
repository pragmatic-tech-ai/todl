// shell.resources.mu — the TODL app's shell chrome.
//
// A custom template for the framework ViewerShell: header + a left navigation
// rail + a titled side panel (bounded, resizable) that hosts the active
// capability + a central content host (fill). This is the VSCode master/detail
// shape: the rail switches capabilities, the side panel drives selection, and
// the content host shows the selected item's detail view (e.g. the Package
// Manager's PackageView).
//
// The shell publishes a ServiceScope, so `$service(NavigationService)` /
// `$service(ContentHostService)` in the template resolve against it. The rail
// renders via the framework's DataTemplate[NavigationService]; the side panel's
// Content is the active capability's service, rendered by its own DataTemplate
// (type dispatch); the content host presents the ContentHostService, which a
// capability drives via View(x) (empty until something is presented).
//
// Applied by setting Template = @TodlAppShell directly on the root ViewerShell
// instance in app.mu (a local value, so it wins over the framework's default
// ViewerShell style without depending on merge order).

resources AppShell {
    Template x:key="TodlAppShell" [TargetType = ViewerShell] {
        Border [ Fill = @Surface ] {
            DockPanel [ LastChildFill = true ] {
                // Header band — presents the shell's HeaderContent (unset ⇒
                // measures to zero, so no empty band shows).
                Border x:name="PART_HeaderHost" [ DockPanel.Dock = Top ]

                // Navigation rail — the activity bar. Rendered by the
                // framework DataTemplate[NavigationService] as a NavigationRail
                // of the modules' capabilities.
                ContentControl x:name="PART_NavHost"
                    [ DockPanel.Dock = Left,
                      Content        = $service(NavigationService) ]

                // Side panel — a titled pane (bounded width) hosting the active
                // capability. Header = the selected capability's label; Commands
                // = the active service's header actions (a button row rendered by
                // its DataTemplate); Content = the active service, rendered by its
                // DataTemplate. Hidden when SidePaneVisible is false (the header ✕
                // toggles it).
                ShellSideContentPane x:name="PART_SidePane"
                    [ DockPanel.Dock = Left,
                      Width          = 300,
                      Visibility     = $service(NavigationService).SidePaneVisible << ToVisibility,
                      Header         = $service(NavigationService).SelectedItem.Label,
                      Commands       = $service(NavigationService).ActiveService.HeaderCommands,
                      CloseCommand   = $service(NavigationService).ToggleSidePaneCommand,
                      Content        = $service(NavigationService).ActiveService ]

                // Drag handle to resize the side pane (a Splitter resizes its
                // previous sibling). Collapses with the pane.
                Splitter [ DockPanel.Dock = Left,
                           Width          = 6,
                           Visibility     = $service(NavigationService).SidePaneVisible << ToVisibility ]

                // Central content host (fill) — presents the ContentHostService,
                // rendered by the framework DataTemplate[ContentHostService] as a
                // ContentPresenter over its Content (a SERVICE binding, so it stays
                // reactive to every View() swap). Capabilities drive it: the
                // Package Manager View()s the selected package's PackageView; Home
                // clears it. Empty until something is View()'d.
                ContentPresenter x:name="PART_ContentHost"
                    [ Content = $service(ContentHostService) ]
            }
        }
    }
}
