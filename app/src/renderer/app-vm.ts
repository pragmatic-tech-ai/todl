import { MuralBase, MetaData, RelayCommand, type ICommand } from "@pragmatic-tech-ai/mural/runtime";
import type { CorpusEntry } from "@shared/corpus-types.js";
import { PlaygroundVM } from "./pages/playground/playground-vm.js";
import { GalleryVM } from "./pages/gallery/gallery-vm.js";
import { DocsVM } from "./pages/docs/docs-vm.js";
import { PackagesVM } from "./pages/packages/packages-vm.js";
import { SetupVM } from "./pages/setup/setup-vm.js";
import { PublishVM } from "./pages/publish/publish-vm.js";
import { RegistryClient } from "./services/registry-client.js";

export class AppVM extends MuralBase {
  static ActivePageKey = MuralBase.RegisterProperty<MuralBase | undefined>(AppVM, "ActivePage", undefined, MetaData.None);
  static ShowPlaygroundKey = MuralBase.RegisterProperty<ICommand | undefined>(AppVM, "ShowPlayground", undefined, MetaData.None);
  static ShowGalleryKey = MuralBase.RegisterProperty<ICommand | undefined>(AppVM, "ShowGallery", undefined, MetaData.None);
  static ShowDocsKey = MuralBase.RegisterProperty<ICommand | undefined>(AppVM, "ShowDocs", undefined, MetaData.None);
  static ShowPackagesKey = MuralBase.RegisterProperty<ICommand | undefined>(AppVM, "ShowPackages", undefined, MetaData.None);
  static ShowPublishKey = MuralBase.RegisterProperty<ICommand | undefined>(AppVM, "ShowPublish", undefined, MetaData.None);
  static ShowSetupKey = MuralBase.RegisterProperty<ICommand | undefined>(AppVM, "ShowSetup", undefined, MetaData.None);

  private readonly client = new RegistryClient();
  private readonly playground = new PlaygroundVM();
  private readonly gallery = new GalleryVM((e) => this.openInPlayground(e));
  private readonly docs = new DocsVM();
  private readonly packages = new PackagesVM(this.client, (name) => this.openPackageSources(name), () => this.showSetup());
  private readonly setup = new SetupVM(this.client);
  private readonly publish = new PublishVM(this.client);

  get ActivePage(): MuralBase | undefined { return this.get_property_value(AppVM.ActivePageKey); }
  get ShowPlayground(): ICommand | undefined { return this.get_property_value(AppVM.ShowPlaygroundKey); }
  get ShowGallery(): ICommand | undefined { return this.get_property_value(AppVM.ShowGalleryKey); }
  get ShowDocs(): ICommand | undefined { return this.get_property_value(AppVM.ShowDocsKey); }
  get ShowPackages(): ICommand | undefined { return this.get_property_value(AppVM.ShowPackagesKey); }
  get ShowPublish(): ICommand | undefined { return this.get_property_value(AppVM.ShowPublishKey); }
  get ShowSetup(): ICommand | undefined { return this.get_property_value(AppVM.ShowSetupKey); }

  constructor() {
    super();
    this.set_property_value(AppVM.ActivePageKey, this.playground);
    this.set_property_value(AppVM.ShowPlaygroundKey, new RelayCommand(() => this.set_property_value(AppVM.ActivePageKey, this.playground)));
    this.set_property_value(AppVM.ShowGalleryKey, new RelayCommand(() => this.set_property_value(AppVM.ActivePageKey, this.gallery)));
    this.set_property_value(AppVM.ShowDocsKey, new RelayCommand(() => this.set_property_value(AppVM.ActivePageKey, this.docs)));
    this.set_property_value(AppVM.ShowPackagesKey, new RelayCommand(() => {
      this.set_property_value(AppVM.ActivePageKey, this.packages);
      void this.packages.load();
    }));
    this.set_property_value(AppVM.ShowPublishKey, new RelayCommand(() => {
      this.set_property_value(AppVM.ActivePageKey, this.publish);
    }));
    this.set_property_value(AppVM.ShowSetupKey, new RelayCommand(() => this.showSetup()));
  }

  showSetup(): void {
    this.set_property_value(AppVM.ActivePageKey, this.setup);
    void this.setup.load();
  }

  openInPlayground(entry: CorpusEntry): void {
    this.playground.load(entry);
    this.set_property_value(AppVM.ActivePageKey, this.playground);
  }

  openPackageSources(name: string): void {
    void this.client.getSources({ name }).then((sources) => {
      this.playground.loadSource(sources);
      this.set_property_value(AppVM.ActivePageKey, this.playground);
    });
  }
}
