import PublishVM from "./publish-vm.ts"

resources Publish {
    DataTemplate [DataType = PublishVM] {
        StackPanel [ Orientation = Vertical, Margin = (16,16,16,16) ] {
            TextBlock [ FontSize = 18, FontWeight = Bold, Text = $Title ]
            TextBlock [ Margin = (0,10,0,0), FontSize = 11, Foreground = @OnSurfaceVariant, Text = "Project directory" ]
            StackPanel [ Orientation = Horizontal, Margin = (0,6,0,0) ] {
                Button [ Margin = (0,0,8,0), Command = $Choose ] { TextBlock [ Text = "Choose folder…" ] }
                TextBlock [ FontSize = 12, Text = $Dir ]
            }
            Button [ Margin = (0,12,0,0), Command = $Publish ] { TextBlock [ Text = "Publish to registry" ] }
            TextBlock [ Margin = (0,10,0,0), FontSize = 12, Text = $Status ]
        }
    }
}
