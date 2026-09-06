import PlaygroundVM from "./playground-vm.ts"
import PlaygroundDocument from "./playground-document.ts"

resources PlaygroundResources {
    // The document tab: hosts its PlaygroundVM, whose own template renders the
    // editor + graph. (A PlaygroundDocument is an IDocument; the content host
    // materializes it through this template.)
    DataTemplate [DataType = PlaygroundDocument] {
        ContentControl [ Content = $VM ]
    }

    DataTemplate [DataType = PlaygroundVM] {
        DockPanel {
            DockPanel [ DockPanel.Dock = Top, Margin = (8,8,8,4) ] {
                TextBlock [ DockPanel.Dock = Left, Margin = (0,4,8,0), Text = "Example:" ]
                Button    [ DockPanel.Dock = Right, Command = $CopyLink ] { TextBlock [ Text = "Copy link" ] }
                TextBlock [ DockPanel.Dock = Right, Margin = (12,4,8,0), Visibility = $GoldenVisibility, FontWeight = Bold, Text = $GoldenStatus ]
                ComboBox  [ Width = 320, Items = $Refs, SelectedItem = $Selected ]
            }
            ContentControl [ Content = $Runner ]
        }
    }
}
