import PackageManagerService from "./package-manager-service.ts"
import PackageManagerHeaderVM from "./package-manager-header-vm.ts"
import EditorPaneVM from "./editor-pane-vm.ts"
import TreeNodeVM from "./tree-node-vm.ts"
import GraphPaneVM from "./graph/graph-pane-vm.ts"

resources PackageManagerResources {
    // The Packages capability — rendered in the shell side panel by the
    // framework ContentPresenter (DataContext = the PackageManagerService). A
    // status line over the per-package content TreeView. The tree is data-driven
    // (ItemsSource = $Roots) so the framework generates + realizes the rows;
    // SelectedDataItem two-way-binds the picked node back to the service.
    DataTemplate [DataType = PackageManagerService] {
        DockPanel [ LastChildFill = true ] {
            ContentControl [ DockPanel.Dock = Top, Content = $Commands, Margin = (8,8,8,4) ]
            TextBlock [ DockPanel.Dock = Top, Margin = (8,0,8,4), Text = $Status ]
            TreeView [ ItemsSource = $Roots, ItemTemplate = @PackageNodeTemplate, SelectedDataItem = $SelectedNode ]
        }
    }

    // One tree node — its label. `itemsselector = Children` walks the recursive
    // structure (undefined Children ⇒ a leaf row). Set as the TreeView's
    // ItemTemplate (TreeView resolves rows from ItemTemplate, not implicitly by
    // DataType), which both renders the header and recurses the children.
    HierarchicalDataTemplate x:key="PackageNodeTemplate" [DataType = TreeNodeVM, itemsselector = Children] {
        TextBlock [ Text = $Header, Margin = (4,0,4,0) ]
    }

    // The command ToolBar pinned atop the side-pane body — the Refresh button.
    DataTemplate [DataType = PackageManagerHeaderVM] {
        ToolBar {
            ToolBarButton [ Command = $Refresh, Text = "Refresh", ShowText = true ]
        }
    }

    // The central content-host view — the shared editable Monaco editor the tree
    // routes content into. Wrapped in a DockPanel so the ContentControl is sized
    // (a ContentControl as the bare template root does not size its element).
    DataTemplate [DataType = EditorPaneVM] {
        DockPanel [ LastChildFill = true ] {
            ContentControl [ Content = $Editor ]
        }
    }

    // The Diagram's canvas panel — a paginated canvas the Diagram's ScrollViewer
    // tracks as the laid-out nodes extend past the initial page. Paper + page
    // border use the scheme-adaptive @DiagramCanvas / @OutlineVariant tokens
    // (PaginatedCanvas otherwise hardcodes white paper), so the surface follows
    // the active scheme — dark in MaterialDark instead of a white sheet.
    ItemsPanelTemplate x:key="GraphCanvasPanel" {
        PaginatedCanvas [ PageWidth = 2000, PageHeight = 2000,
                          PaperBrush = @DiagramCanvas, PageBorderBrush = @OutlineVariant ]
    }

    // The central content-host view for a compiled model.json graph: a header row
    // of two toggle "tabs" (Visual / Text) over a body that visibility-swaps the
    // graph Diagram and the read-only Monaco. A composed mural TabControl mounts
    // unselected AND doesn't paint composed TabItem headers in this content host,
    // so this uses ToggleButtons (whose content DOES render) as a radio pair bound
    // to the VM's mutually-exclusive ShowVisual/ShowText.
    DataTemplate [DataType = GraphPaneVM] {
      DockPanel [ LastChildFill = true, ClipToBounds = true ] {
        // Tab strip.
        StackPanel [ DockPanel.Dock = Top, Orientation = Horizontal, Margin = (8,6,8,4) ] {
            ToggleButton [ IsChecked = $ShowVisual, Margin = (0,0,6,0) ] {
                TextBlock [ Text = "Visual", Foreground = @OnSurface ]
            }
            ToggleButton [ IsChecked = $ShowText ] {
                TextBlock [ Text = "Text", Foreground = @OnSurface ]
            }
        }
        // Body — both panes stacked; exactly one is visible.
        Grid {
            // Visual: tier-filter toggles over the graph Diagram.
            DockPanel [ LastChildFill = true, Visibility = $ShowVisual << ToVisibility ] {
                StackPanel [ DockPanel.Dock = Top, Orientation = Horizontal, Margin = (8,4,8,6) ] {
                    TextBlock [ Text = "Tiers:", Foreground = @OnSurface, VerticalAlignment = Center, Margin = (0,0,8,0) ]
                    ToggleButton [ IsChecked = $ShowMeta, Margin = (0,0,8,0) ] { TextBlock [ Text = "Meta", Foreground = @OnSurface ] }
                    ToggleButton [ IsChecked = $ShowOntology, Margin = (0,0,8,0) ] { TextBlock [ Text = "Ontology", Foreground = @OnSurface ] }
                    ToggleButton [ IsChecked = $ShowInstance ] { TextBlock [ Text = "Instance", Foreground = @OnSurface ] }
                }
                Diagram
                    [ ItemsSource                  = $Nodes,
                      Connectors                   = $Connectors,
                      ItemsPanel                   = @GraphCanvasPanel,
                      SelectionMode                = Extended,
                      ConnectorInteractionsEnabled = false,
                      CameraEnabled                = true,
                      Focusable                    = true ]
            }
            // Text: the raw JSON in a read-only Monaco.
            DockPanel [ LastChildFill = true, Visibility = $ShowText << ToVisibility ] {
                ContentControl [ Content = $TextEditor ]
            }
        }
      }
    }
}
