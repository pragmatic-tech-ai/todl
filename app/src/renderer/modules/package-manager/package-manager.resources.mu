import PackageManagerService from "./package-manager-service.ts"
import PackageItemVM from "./package-item-vm.ts"
import PackageManagerHeaderVM from "./package-manager-header-vm.ts"

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
}
