import PackageCompilerService from "./package-compiler-service.ts"
import PackageCompilerActionVM from "./package-compiler-action-vm.ts"
import CompileResultVM from "./compile-result-vm.ts"

resources PackageCompilerResources {
    // Side panel — the opened directory + status over an action list. The
    // actions are a ListBox (not buttons): interactive buttons don't receive
    // input in the pane body in this build, but ListBox rows do. Selecting a
    // row runs it.
    DataTemplate [DataType = PackageCompilerService] {
        DockPanel [ LastChildFill = true ] {
            TextBlock [ DockPanel.Dock = Top, Text = $Directory, Margin = (12,12,12,4) ]
            TextBlock [ DockPanel.Dock = Top, Text = $Status, Margin = (12,0,12,8) ]
            ListBox [ ItemsSource = $Actions, SelectedItem = $SelectedAction ]
        }
    }

    // One action row.
    DataTemplate [DataType = PackageCompilerActionVM] {
        TextBlock [ Text = $Name, Margin = (8,4,8,4) ]
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
