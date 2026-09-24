import { ConceptHeaderVM, InstanceRowVM } from "./model-browser-vm.js";
import { Border, DataTemplate, ItemsPanelTemplate, Orientation, StackPanel, TextBlock } from "@pragmatic-tech-ai/mural/basic";
import { ItemsControl } from "@pragmatic-tech-ai/mural/framework/base/items-control.js";
import { ScrollViewer } from "@pragmatic-tech-ai/mural/framework/surfaces/scroll-viewer.js";
import { DataContextBinding, DynamicResource, NameScope, ResourceDictionary, Thickness } from "@pragmatic-tech-ai/mural/runtime";
import { FontWeight } from "@pragmatic-tech-ai/mural/visual-engine";


const _gate_ModelBrowserResources = Symbol("ModelBrowserResources.ctor");
export class ModelBrowserResources extends ResourceDictionary {
    constructor(_g) {
        super();
        if (_g !== _gate_ModelBrowserResources) {
            throw new Error("ModelBrowserResources is private — use ModelBrowserResources.Clone()");
        }
    }
    static Clone() {
        const t = new ModelBrowserResources(_gate_ModelBrowserResources);
        const _tmpl0 = new ItemsPanelTemplate(() => {
            const _stackPanel1 = new StackPanel();
            _stackPanel1.set_property_value(StackPanel.OrientationKey, Orientation.Vertical);
            return _stackPanel1;
        });
        t.Set("RowsPanel", _tmpl0);
        const _tmpl2 = new DataTemplate((_data) => {
            const _textBlock3 = new TextBlock();
            _textBlock3.set_property_value(TextBlock.TextKey, DataContextBinding(_textBlock3, "Concept"));
            _textBlock3.set_property_value(TextBlock.FontSizeKey, 16);
            _textBlock3.set_property_value(TextBlock.FontWeightKey, FontWeight.Bold);
            _textBlock3.set_property_value(TextBlock.ForegroundKey, DynamicResource(_textBlock3, "OnSurface"));
            _textBlock3.set_property_value(TextBlock.MarginKey, new Thickness(12, 10, 12, 4));
            return _textBlock3;
        }, ConceptHeaderVM);
        t.Set(ConceptHeaderVM, _tmpl2);
        const _tmpl4 = new DataTemplate((_data) => {
            const _textBlock5 = new TextBlock();
            _textBlock5.set_property_value(TextBlock.TextKey, DataContextBinding(_textBlock5, "Text"));
            _textBlock5.set_property_value(TextBlock.FontSizeKey, 13);
            _textBlock5.set_property_value(TextBlock.ForegroundKey, DynamicResource(_textBlock5, "OnSurfaceVariant"));
            _textBlock5.set_property_value(TextBlock.MarginKey, new Thickness(24, 2, 12, 2));
            return _textBlock5;
        }, InstanceRowVM);
        t.Set(InstanceRowVM, _tmpl4);
        const _border6 = new Border();
        _border6.SetNameScope(new NameScope());
        _border6.set_property_value(Border.FillKey, DynamicResource(_border6, "Surface"));
        const _scrollViewer7 = new ScrollViewer();
        const _itemsControl8 = new ItemsControl();
        _itemsControl8.set_property_value(ItemsControl.ItemsSourceKey, DataContextBinding(_itemsControl8, "Rows"));
        _itemsControl8.set_property_value(ItemsControl.ItemsPanelKey, _tmpl0);
        _scrollViewer7.Content = _itemsControl8;
        _border6.SetChild(_scrollViewer7);
        t.Root = _border6;
        return t;
    }
    get RowsPanel() { return this.Resolve("RowsPanel"); }
    set RowsPanel(v) { this.Set("RowsPanel", v); }
}
