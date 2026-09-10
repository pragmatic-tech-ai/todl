import PackageCompilerService from "./package-compiler-service.ts"
import PackageCompilerHeaderVM from "./package-compiler-header-vm.ts"
import FolderNodeVM from "./folder-node-vm.ts"
import CompileResultVM from "./compile-result-vm.ts"

resources PackageCompilerResources {
    // Side panel body — a local command ToolBar pinned across the top, the opened
    // folder's contents as a TreeView filling the pane, and the status line at the
    // bottom. The ToolBar's own overflow (chevron popup) absorbs any buttons that
    // don't fit the pane width.
    DataTemplate [DataType = PackageCompilerService] {
        DockPanel [ LastChildFill = true ] {
            ContentControl [ DockPanel.Dock = Top, Content = $Commands, Margin = (8,8,8,4) ]
            TextBlock [ DockPanel.Dock = Bottom, Text = $Status, Margin = (12,4,12,8) ]
            TreeView [ ItemsSource = $Tree, ItemTemplate = @CompilerFolderTemplate ]
        }
    }

    // One folder-tree node — its name. `itemsselector = Children` walks the
    // recursive structure (undefined Children ⇒ a file/leaf row). Set as the
    // TreeView's ItemTemplate (rows resolve from ItemTemplate, not implicitly by
    // DataType).
    HierarchicalDataTemplate x:key="CompilerFolderTemplate" [DataType = FolderNodeVM, itemsselector = Children] {
        TextBlock [ Text = $Header, Margin = (4,0,4,0) ]
    }

    // The command ToolBar. Open/Compile/Publish are always shown; Bump/Delete are
    // the 409-conflict recovery choices, hidden until a publish conflicts
    // ($ConflictVisible) — when shown they overflow into the ToolBar's chevron.
    DataTemplate [DataType = PackageCompilerHeaderVM] {
        ToolBar {
            ToolBarButton [ Command = $Open,    Text = "Open",    ShowText = true ]
            ToolBarButton [ Command = $Compile, Text = "Compile", ShowText = true ]
            ToolBarButton [ Command = $Publish, Text = "Publish", ShowText = true ]
            ToolBarButton [ Command = $Bump,   Text = "Bump version",   ShowText = true, Visibility = $ConflictVisible << ToVisibility ]
            ToolBarButton [ Command = $Delete, Text = "Delete version", ShowText = true, Visibility = $ConflictVisible << ToVisibility ]
        }
    }

    // The central content-host view for a compiled package — identity + summary
    // over the (scrollable) files and diagnostics, each as flattened text.
    DataTemplate [DataType = CompileResultVM] {
        DockPanel [ LastChildFill = true ] {
            StackPanel [ DockPanel.Dock = Top, Margin = (16,16,16,8) ] {
                TextBlock [ Text = $Title, FontWeight = Bold ]
                TextBlock [ Text = $Summary, Margin = (0,4,0,0) ]
            }
            ScrollViewer {
                StackPanel [ Orientation = Vertical, Margin = (16,0,16,16) ] {
                    TextBlock [ Text = "Files", FontWeight = Bold, Margin = (0,8,0,4) ]
                    TextBlock [ Text = $FilesText ]
                    TextBlock [ Text = "Diagnostics", FontWeight = Bold, Margin = (0,12,0,4) ]
                    TextBlock [ Text = $DiagnosticsText ]
                }
            }
        }
    }
}
