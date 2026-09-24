import ConceptHeaderVM from "./model-browser-vm.js"
import InstanceRowVM from "./model-browser-vm.js"

resources ModelBrowserResources {
    DataTemplate [ DataType = ConceptHeaderVM ] {
        TextBlock [ Text = $Concept, FontSize = 16, FontWeight = Bold, Foreground = @OnSurface, Margin = (12,10,12,4) ]
    }
    DataTemplate [ DataType = InstanceRowVM ] {
        TextBlock [ Text = $Text, FontSize = 13, Foreground = @OnSurfaceVariant, Margin = (24,2,12,2) ]
    }
    Border x:root [ Fill = @Surface ] {
        ScrollViewer {
            ItemsControl [ ItemsSource = $Rows ]
        }
    }
}
