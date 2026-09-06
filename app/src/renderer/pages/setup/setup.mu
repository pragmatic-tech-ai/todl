import SetupVM from "./setup-vm.ts"

resources Setup {
    DataTemplate [DataType = SetupVM] {
        StackPanel [ Orientation = Vertical, Margin = (16,16,16,16) ] {
            TextBlock [ FontSize = 18, FontWeight = Bold, Text = $Title ]

            TextBlock [ Margin = (0,14,0,0), FontSize = 12, FontWeight = Bold, Foreground = @Primary, Text = "Registry" ]
            TextBlock [ Margin = (0,6,0,0), FontSize = 11, Foreground = @OnSurfaceVariant, Text = "Registry URL" ]
            TextBox [ Text = $Registry ]
            TextBlock [ Margin = (0,6,0,0), FontSize = 11, Foreground = @OnSurfaceVariant, Text = "Scope" ]
            TextBox [ Text = $Scope ]
            TextBlock [ Margin = (0,6,0,0), FontSize = 11, Foreground = @OnSurfaceVariant, Text = "Org" ]
            TextBox [ Text = $Org ]
            Button [ Margin = (0,8,0,0), Command = $SaveSettings ] { TextBlock [ Text = "Save connection" ] }

            TextBlock [ Margin = (0,18,0,0), FontSize = 12, FontWeight = Bold, Foreground = @Primary, Text = "Auth token" ]
            TextBlock [ FontSize = 12, Text = $Status ]

            TextBlock [ Margin = (0,10,0,0), FontSize = 11, Foreground = @OnSurfaceVariant, Text = "Stored token" ]
            TextBox [ Text = $TokenInput ]
            StackPanel [ Orientation = Horizontal, Margin = (0,6,0,0) ] {
                Button [ Margin = (0,0,8,0), Command = $SaveToken ] { TextBlock [ Text = "Save token" ] }
                Button [ Command = $ClearToken ] { TextBlock [ Text = "Clear" ] }
            }

            TextBlock [ Margin = (0,12,0,0), FontSize = 11, Foreground = @OnSurfaceVariant, Text = "…or use an environment variable" ]
            StackPanel [ Orientation = Horizontal, Margin = (0,6,0,0) ] {
                ComboBox [ Width = 280, ItemsSource = $EnvVars, SelectedItem = $SelectedEnvVar ]
                Button [ Margin = (8,0,0,0), Command = $UseEnv ] { TextBlock [ Text = "Use env var" ] }
            }
        }
    }
}
