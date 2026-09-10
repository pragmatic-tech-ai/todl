import HomeVM from "./home-vm.ts"
import RecentSolutionVM from "./recent-solution-vm.ts"

resources HomeResources {
    // The welcome/landing page, rendered in the shell's side panel by
    // DataTemplate[HomeVM]. Title + blurb, the two primary actions (New / Open
    // Solution), and the recent-solutions list.
    DataTemplate [DataType = HomeVM] {
        StackPanel [ Orientation = Vertical, Margin = (16) ] {
            TextBlock [ Text = $Title, FontWeight = Bold, Margin = (0,0,0,8) ]
            TextBlock [ Text = $Message, TextWrapping = Wrap, Margin = (0,0,0,16) ]
            Button [ Command = $New,  Content = "New Solution",  Margin = (0,0,0,6) ]
            Button [ Command = $Open, Content = "Open Solution", Margin = (0,0,0,16) ]
            TextBlock [ Text = "Recent solutions", FontWeight = Bold, Margin = (0,0,0,6) ]
            ItemsControl [ ItemsSource = $Recent ]
        }
    }

    // One recent-solution row — a button whose label is the folder path; clicking
    // it reopens that solution.
    DataTemplate [DataType = RecentSolutionVM] {
        Button [ Command = $Open, Content = $Path, Margin = (0,0,0,4) ]
    }
}
