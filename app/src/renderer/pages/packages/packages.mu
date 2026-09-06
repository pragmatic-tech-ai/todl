import PackagesVM from "./packages-vm.ts"
import PackageItemVM from "./package-item-vm.ts"
import PackageDetailVM from "./package-detail-vm.ts"

resources Packages {
    DataTemplate x:key="PackageItemTemplate" [DataType = PackageItemVM] {
        Border [ Fill = @SurfaceVariant, Padding = (12,8,12,8), Margin = (0,0,0,6) ] {
            DockPanel {
                TextBlock [ DockPanel.Dock = Right, FontSize = 10, Foreground = @Primary, Text = $Kind ]
                TextBlock [ FontSize = 13, Text = $Name ]
            }
        }
    }
    DataTemplate [DataType = PackageDetailVM] {
        StackPanel [ Orientation = Vertical, Margin = (16,16,16,16) ] {
            TextBlock [ FontSize = 18, FontWeight = Bold, Text = $Title ]
            TextBlock [ Margin = (0,10,0,0), FontSize = 11, Foreground = @OnSurfaceVariant, Text = "Kind" ]
            TextBlock [ FontSize = 13, Text = $Kind ]
            TextBlock [ Margin = (0,10,0,0), FontSize = 11, Foreground = @OnSurfaceVariant, Text = "Version" ]
            TextBlock [ FontSize = 13, Text = $Version ]
            TextBlock [ Margin = (0,10,0,0), FontSize = 11, Foreground = @OnSurfaceVariant, Text = "Dist-tags" ]
            TextBlock [ FontSize = 13, Text = $DistTags ]
            TextBlock [ Margin = (0,10,0,0), FontSize = 11, Foreground = @OnSurfaceVariant, Text = "Dependencies" ]
            TextBlock [ FontSize = 13, Text = $Dependencies ]
            TextBlock [ Margin = (0,10,0,0), FontSize = 11, Foreground = @OnSurfaceVariant, Text = "Resolved closure" ]
            TextBlock [ FontSize = 13, Text = $Closure ]
            TextBlock [ Margin = (0,10,0,0), FontSize = 11, Foreground = @OnSurfaceVariant, Text = "Compiled content" ]
            TextBlock [ FontSize = 13, Text = $Content ]
            Button [ Margin = (0,16,0,0), Command = $Open ] { TextBlock [ Text = "Open in Playground" ] }
        }
    }
    DataTemplate [DataType = PackagesVM] {
        DockPanel {
            TextBlock [ DockPanel.Dock = Top, Margin = (12,12,12,8), FontSize = 18, FontWeight = Bold, Text = $Title ]
            Border [ DockPanel.Dock = Top, Visibility = $SettingsVisibility, Margin = (12,0,12,8), Fill = @SurfaceVariant, Padding = (12,10,12,10) ] {
                StackPanel [ Orientation = Vertical ] {
                    TextBlock [ FontSize = 12, Text = $StatusMessage ]
                    Button [ Margin = (0,8,0,0), Command = $Configure ] { TextBlock [ Text = "Open Setup" ] }
                }
            }
            Border [ DockPanel.Dock = Left, Width = 260 ] {
                ListBox [ Margin = (12,0,12,12), ItemsSource = $Items, ItemTemplate = @PackageItemTemplate, SelectedItem = $Selected ]
            }
            ContentControl [ Content = $Detail ]
        }
    }
}
