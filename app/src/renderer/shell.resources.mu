// shell.resources.mu — the TODL app's shell chrome.
//
// A custom template for the framework ViewerShell: header + a left navigation
// rail + a titled side panel that hosts the active capability. This is the
// "rail + side panel only" layout — the ShellSideContentPane is the fill
// region (LastChildFill), so the active capability's service fills the panel
// and there is no separate content area to its right.
//
// The shell publishes a ServiceScope, so `$service(NavigationService)` in the
// template resolves against it. The rail renders via the framework's
// DataTemplate[NavigationService]; the side panel's Content is the active
// capability's service, rendered by its own DataTemplate (type dispatch).
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

                // Side panel (fill) — a titled pane hosting the active
                // capability. Header = the selected capability's label; Commands
                // = the active service's header actions (a button row rendered by
                // its DataTemplate); Content = the active service, rendered by its
                // DataTemplate. Hidden when SidePaneVisible is false (the header ✕
                // toggles it).
                ShellSideContentPane x:name="PART_SidePane"
                    [ Visibility   = $service(NavigationService).SidePaneVisible << ToVisibility,
                      Header       = $service(NavigationService).SelectedItem.Label,
                      Commands     = $service(NavigationService).ActiveService.HeaderCommands,
                      CloseCommand = $service(NavigationService).ToggleSidePaneCommand,
                      Content      = $service(NavigationService).ActiveService ]
            }
        }
    }
}
