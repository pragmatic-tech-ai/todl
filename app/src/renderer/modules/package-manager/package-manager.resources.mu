import PackageManagerService from "./package-manager-service.ts"
import PackageItemVM from "./package-item-vm.ts"
import PackageManagerHeaderVM from "./package-manager-header-vm.ts"
import PackageViewVM from "./package-view-vm.ts"

resources PackageManagerResources {
    // The Packages capability — rendered in the shell side panel by the
    // framework ContentPresenter (DataContext = the PackageManagerService, so
    // single-level $bindings resolve against it). A status line over a ListBox
    // of the registry's packages.
    DataTemplate [DataType = PackageManagerService] {
        DockPanel [ LastChildFill = true ] {
            TextBlock [ DockPanel.Dock = Top, Margin = (8,8,8,4), Text = $Status ]
            ListBox [ ItemsSource = $Packages, SelectedItem = $SelectedPackage ]
        }
    }

    // One package row — its name.
    DataTemplate [DataType = PackageItemVM] {
        TextBlock [ Text = $Name, Margin = (8,4,8,4) ]
    }

    // Pane-header actions (ShellSideContentPane.Commands) — the Refresh button.
    DataTemplate [DataType = PackageManagerHeaderVM] {
        Button [ Command = $Refresh ] {
            TextBlock [ Text = "Refresh" ]
        }
    }

    // The central content-host view for the selected package — a dependency
    // header over an editable TODL source editor. The editor ($Editor, a
    // MonacoEditorHost the VM owns) fills the pane and honours the newlines
    // between files (a NoWrap TextBlock collapsed them onto one line) and
    // colours the TODL grammar; it is presented directly via ContentControl.
    DataTemplate [DataType = PackageViewVM] {
        DockPanel [ LastChildFill = true ] {
            StackPanel [ DockPanel.Dock = Top, Margin = (16,16,16,8) ] {
                TextBlock [ Text = $Name, FontWeight = Bold ]
                TextBlock [ Text = $Dependencies, Margin = (0,4,0,0) ]
                TextBlock [ Text = $Status, Margin = (0,4,0,0) ]
            }
            ContentControl [ Content = $Editor, Margin = (16,0,16,16) ]
        }
    }
}
