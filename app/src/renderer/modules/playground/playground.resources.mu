import PlaygroundDocument from "./playground-document.ts"

resources PlaygroundResources {
    // NOTE (blocked): the framework document presenter matches this template and
    // single-level $bindings resolve ($Title works), but nested VM hosting
    // (ContentControl[Content=$VM] -> DataTemplate[PlaygroundVM]) does NOT resolve
    // from inside a framework-instantiated template in this mural build, and
    // dotted paths ($VM.X) / DataContext rebind do not work either. Pending a
    // decision on how to host sub-views (flatten onto the document vs a mural
    // resource-scope fix), this shows the document title as a placeholder.
    DataTemplate [DataType = PlaygroundDocument] {
        TextBlock [ Margin = (12,12,12,12), Text = $Title ]
    }
}
