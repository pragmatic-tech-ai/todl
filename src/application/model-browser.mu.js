import { ConceptHeaderVM, InstanceRowVM } from "./model-browser-vm.js";
import { Border, DataTemplate, TextBlock } from "@pragmatic-tech-ai/mural/basic";
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
        const _tmpl0 = new DataTemplate((_data) => {
            const _textBlock1 = new TextBlock();
            _textBlock1.set_property_value(TextBlock.TextKey, DataContextBinding(_textBlock1, "Concept"));
            _textBlock1.set_property_value(TextBlock.FontSizeKey, 16);
            _textBlock1.set_property_value(TextBlock.FontWeightKey, FontWeight.Bold);
            _textBlock1.set_property_value(TextBlock.ForegroundKey, DynamicResource(_textBlock1, "OnSurface"));
            _textBlock1.set_property_value(TextBlock.MarginKey, new Thickness(12, 10, 12, 4));
            return _textBlock1;
        }, ConceptHeaderVM);
        t.Set(ConceptHeaderVM, _tmpl0);
        const _tmpl2 = new DataTemplate((_data) => {
            const _textBlock3 = new TextBlock();
            _textBlock3.set_property_value(TextBlock.TextKey, DataContextBinding(_textBlock3, "Text"));
            _textBlock3.set_property_value(TextBlock.FontSizeKey, 13);
            _textBlock3.set_property_value(TextBlock.ForegroundKey, DynamicResource(_textBlock3, "OnSurfaceVariant"));
            _textBlock3.set_property_value(TextBlock.MarginKey, new Thickness(24, 2, 12, 2));
            return _textBlock3;
        }, InstanceRowVM);
        t.Set(InstanceRowVM, _tmpl2);
        const _border4 = new Border();
        _border4.SetNameScope(new NameScope());
        _border4.set_property_value(Border.FillKey, DynamicResource(_border4, "Surface"));
        const _scrollViewer5 = new ScrollViewer();
        const _itemsControl6 = new ItemsControl();
        _itemsControl6.set_property_value(ItemsControl.ItemsSourceKey, DataContextBinding(_itemsControl6, "Rows"));
        _scrollViewer5.Content = _itemsControl6;
        _border4.SetChild(_scrollViewer5);
        t.Root = _border4;
        return t;
    }
}
