import ConceptHeaderVM from "./model-browser-vm.js"
import InstanceRowVM from "./model-browser-vm.js"

resources ModelBrowserResources {
    // A plain ItemsControl has no default ItemsPanel, so without an explicit one it
    // materializes zero item containers (proven in drag-drop-extended.mu). A vertical
    // StackPanel stacks the header/row items top-to-bottom.
    ItemsPanelTemplate x:key="RowsPanel" {
        StackPanel [ Orientation = Vertical ]
    }
    DataTemplate [ DataType = ConceptHeaderVM ] {
        TextBlock [ Text = $Concept, FontSize = 16, FontWeight = Bold, Foreground = @Fg1, Margin = (12,10,12,4) ]
    }
    DataTemplate [ DataType = InstanceRowVM ] {
        TextBlock [ Text = $Text, FontSize = 13, Foreground = @Fg2, Margin = (24,2,12,2) ]
    }
    Border x:root [ Fill = @Bg1 ] {
        ScrollViewer {
            ItemsControl [ ItemsSource = $Rows, ItemsPanel = @RowsPanel ]
        }
    }
}
