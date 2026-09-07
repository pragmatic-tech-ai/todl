import HomeVM from "./home-vm.ts"

resources HomeResources {
    // Rendered in the shell's side panel (ShellSideContentPane.Content =
    // NavigationService.ActiveService) by the framework ContentPresenter, which
    // dispatches to this template by the active service's runtime type. The
    // DataContext is the HomeVM, so single-level $bindings resolve against it.
    DataTemplate [DataType = HomeVM] {
        StackPanel [ Orientation = Vertical, Margin = (12) ] {
            TextBlock [ Text = $Title, FontWeight = Bold, Margin = (0,0,0,8) ]
            TextBlock [ Text = $Message, TextWrapping = Wrap ]
        }
    }
}
