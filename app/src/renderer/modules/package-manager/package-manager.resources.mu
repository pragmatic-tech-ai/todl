import PackageManagerService from "./package-manager-service.ts"
import PackageManagerHeaderVM from "./package-manager-header-vm.ts"
import EditorPaneVM from "./editor-pane-vm.ts"
import TreeNodeVM from "./tree-node-vm.ts"

resources PackageManagerResources {
    // The Packages capability — rendered in the shell side panel by the
    // framework ContentPresenter (DataContext = the PackageManagerService). A
    // status line over the per-package content TreeView. The tree is data-driven
    // (ItemsSource = $Roots) so the framework generates + realizes the rows;
    // SelectedDataItem two-way-binds the picked node back to the service.
    DataTemplate [DataType = PackageManagerService] {
        DockPanel [ LastChildFill = true ] {
            ContentControl [ DockPanel.Dock = Top, Content = $Commands, Margin = (8,8,8,4) ]
            TextBlock [ DockPanel.Dock = Top, Margin = (8,0,8,4), Text = $Status ]
            TreeView [ ItemsSource = $Roots, ItemTemplate = @PackageNodeTemplate, SelectedDataItem = $SelectedNode ]
        }
    }

    // One tree node — its label. `itemsselector = Children` walks the recursive
    // structure (undefined Children ⇒ a leaf row). Set as the TreeView's
    // ItemTemplate (TreeView resolves rows from ItemTemplate, not implicitly by
    // DataType), which both renders the header and recurses the children.
    HierarchicalDataTemplate x:key="PackageNodeTemplate" [DataType = TreeNodeVM, itemsselector = Children] {
        TextBlock [ Text = $Header, Margin = (4,0,4,0) ]
    }

    // The command ToolBar pinned atop the side-pane body — the Refresh button.
    DataTemplate [DataType = PackageManagerHeaderVM] {
        ToolBar {
            ToolBarButton [ Command = $Refresh, Text = "Refresh", ShowText = true ]
        }
    }

    // The central content-host view — the shared editable Monaco editor the tree
    // routes content into. Wrapped in a DockPanel so the ContentControl is sized
    // (a ContentControl as the bare template root does not size its element).
    DataTemplate [DataType = EditorPaneVM] {
        DockPanel [ LastChildFill = true ] {
            ContentControl [ Content = $Editor ]
        }
    }
}
