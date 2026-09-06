import AppVM from "./app-vm.ts"

resources AppShell {
    DataTemplate [DataType = AppVM] {
        DockPanel {
            Border [ DockPanel.Dock = Left, Fill = @SurfaceVariant, Width = 160 ] {
                StackPanel [ Orientation = Vertical, Margin = (8,8,8,8) ] {
                    Button [ Command = $ShowPlayground, Margin = (0,0,0,4) ] { TextBlock [ Text = "Playground" ] }
                    Button [ Command = $ShowGallery,    Margin = (0,0,0,4) ] { TextBlock [ Text = "Gallery" ] }
                    Button [ Command = $ShowDocs, Margin = (0,0,0,4) ]      { TextBlock [ Text = "Docs" ] }
                    Button [ Command = $ShowPackages, Margin = (0,0,0,4) ]   { TextBlock [ Text = "Packages" ] }
                    Button [ Command = $ShowPublish, Margin = (0,0,0,4) ]     { TextBlock [ Text = "Publish" ] }
                    Button [ Command = $ShowSetup ]                           { TextBlock [ Text = "Setup" ] }
                }
            }
            ContentControl [ Content = $ActivePage ]
        }
    }
}
