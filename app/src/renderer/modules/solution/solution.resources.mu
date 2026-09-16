import SolutionExplorerService from "./solution-explorer-service.ts"
import SolutionCommandsVM from "./solution-commands-vm.ts"
import SolutionMemberNodeVM from "@pragmatic-tech-ai/todl"

resources SolutionResources {
    // Side panel body — a local command ToolBar pinned across the top (New/Open/
    // Save), the cross-project settings PropertyGrid docked at the bottom (shown
    // only when a solution is open), and the member/folder tree filling the rest.
    DataTemplate [DataType = SolutionExplorerService] {
        DockPanel [ LastChildFill = true ] {
            TextBlock [ DockPanel.Dock = Top, Text = $Title, FontWeight = Bold, Margin = (12,10,12,2) ]
            ContentControl [ DockPanel.Dock = Top, Content = $Commands, Margin = (8,4,8,4) ]
            TextBlock [ DockPanel.Dock = Top, Text = $ComposeStatus, Margin = (12,0,12,4), TextWrapping = Wrap, Visibility = $HasSolution << ToVisibility ]
            StackPanel [ DockPanel.Dock = Bottom, Orientation = Vertical, Margin = (8,4,8,8), Visibility = $HasSolution << ToVisibility ] {
                TextBlock [ Text = "Solution settings", FontWeight = Bold, Margin = (4,4,4,4) ]
                PropertyGrid [ Descriptors = $SettingsProperties, Target = $SettingsTarget ]
            }
            TreeView [ ItemsSource = $TreeRoots, ItemTemplate = @SolutionNodeTemplate ]
        }
    }

    // One tree row — a member root or a folder/file beneath it. Both node kinds
    // expose Title + Children, so a single recursive template covers every level
    // (`itemsselector = Children`; an undefined Children ⇒ a leaf row).
    HierarchicalDataTemplate x:key="SolutionNodeTemplate" [DataType = SolutionMemberNodeVM, itemsselector = Children] {
        TextBlock [ Text = $Title, Margin = (4,0,4,0) ]
    }

    // The command ToolBar for the side pane.
    DataTemplate [DataType = SolutionCommandsVM] {
        ToolBar {
            ToolBarButton [ Command = $New,  Text = "New",  ShowText = true ]
            ToolBarButton [ Command = $Open, Text = "Open", ShowText = true ]
            ToolBarButton [ Command = $Save, Text = "Save", ShowText = true ]
            ToolBarButton [ Command = $Compose, Text = "Compose", ShowText = true ]
        }
    }
}
