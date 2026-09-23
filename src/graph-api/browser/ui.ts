import type { IGraphQuery } from "../graph-query.js";
import type { IDomainHost } from "../../domain/domain-host.js";
import { Snapshot } from "../snapshot.js";
import type { InstanceMirror } from "../../manifest/reflection/reflection.js";

// A deliberately minimal three-pane explorer: concepts -> instances -> instance detail.
// Proves the reflection-native query end-to-end; not a product UI.
export class GraphExplorer
{
    private static readonly ConceptsTitle = "Concepts";
    private static readonly InstancesTitle = "Instances";
    private static readonly DetailTitle = "Detail";
    private static readonly IconClass = "todl-icon";

    private readonly api: IGraphQuery;
    private readonly instances: HTMLElement;
    private readonly detail: HTMLElement;

    constructor(private readonly domainHost: IDomainHost, private readonly host: HTMLElement)
    {
        this.api = this.domainHost.Query();
        this.host.innerHTML = "";
        this.host.appendChild(this.Column(GraphExplorer.ConceptsTitle, this.ConceptsList()));
        this.instances = this.Column(GraphExplorer.InstancesTitle, document.createElement("ul"));
        this.detail = this.Column(GraphExplorer.DetailTitle, document.createElement("pre"));
        this.host.appendChild(this.instances);
        this.host.appendChild(this.detail);
    }

    // Resolve a type's icon (async) and prepend an <img> once its bytes arrive. No-op when
    // the type has no icon annotation.
    private AttachIcon(item: HTMLElement, typeId: string): void
    {
        const key = this.api.IconKey(typeId);
        if (key === undefined) return;
        const img = document.createElement("img");
        img.className = GraphExplorer.IconClass;
        item.prepend(img);
        void this.domainHost.Resource(key).then((content) =>
        {
            if (content === undefined) return;
            const buffer = new ArrayBuffer(content.bytes.byteLength);
            new Uint8Array(buffer).set(content.bytes);
            img.src = URL.createObjectURL(new Blob([buffer], { type: content.mime }));
        });
    }

    public Render(): void
    {
        // Construction already rendered the concepts column; nothing further to do.
    }

    private ConceptsList(): HTMLElement
    {
        const list = document.createElement("ul");
        for (const concept of this.api.Concepts())
        {
            const item = document.createElement("li");
            item.textContent = Snapshot.ofType(concept).label;
            this.AttachIcon(item, concept.fullName);
            item.addEventListener("click", () => this.ShowInstances(concept.fullName));
            list.appendChild(item);
        }
        return list;
    }

    private ShowInstances(conceptId: string): void
    {
        const list = this.instances.querySelector("ul")!;
        list.innerHTML = "";
        for (const mirror of this.api.InstancesOf(conceptId))
        {
            const item = document.createElement("li");
            item.textContent = Snapshot.LabelOf(mirror);
            this.AttachIcon(item, mirror.node.type);
            item.addEventListener("click", () => this.ShowDetail(mirror));
            list.appendChild(item);
        }
    }

    private ShowDetail(mirror: InstanceMirror): void
    {
        const snap = Snapshot.of(mirror);
        const key = this.api.IconKey(mirror.node.type);
        if (key !== undefined) snap.iconKey = key;
        this.detail.querySelector("pre")!.textContent = JSON.stringify(snap, null, 2);
    }

    private Column(title: string, body: HTMLElement): HTMLElement
    {
        const column = document.createElement("section");
        const heading = document.createElement("h2");
        heading.textContent = title;
        column.appendChild(heading);
        column.appendChild(body);
        return column;
    }
}
