import { type IServiceContainer } from "@pragmatic-tech-ai/mural/runtime";
import { DialogService } from "@pragmatic-tech-ai/mural/framework";
import {
  SolutionManagerService,
  type IStorageProviderRegistry,
  type IProjectFactoryRegistry,
  type IDiscardConfirmer,
  type IProjectFactory,
} from "@pragmatic-tech-ai/todl";
import { AppStorageProviderRegistry } from "../../services/storage/storage-provider-registry.js";
import { ConfirmDialog } from "../../services/dialogs/confirm-dialog.js";
import { RegistryClient } from "../../services/registry/registry-client.js";
import { IpcPackageSource } from "./ipc-package-source.js";
import { TodlPackageProjectFactory, TODL_PACKAGE_TYPE } from "./todl-package-project-factory.js";

// Resolves a project type id to the factory that opens it. This app ships one
// project type (the TODL package); later modules register more types here.
export class TodlProjectFactoryRegistry implements IProjectFactoryRegistry {
  private readonly todlPackage = new TodlPackageProjectFactory();

  public factoryFor(typeId: string): IProjectFactory | undefined {
    return typeId === TODL_PACKAGE_TYPE ? this.todlPackage : undefined;
  }
}

// Prompts to discard unsaved solution changes via the app's Mural dialog. Keeps
// the SolutionManagerService UI-agnostic — the dialog copy + DialogService stay
// on the app side of the IDiscardConfirmer interface.
export class DialogDiscardConfirmer implements IDiscardConfirmer {
  constructor(private readonly dialogs: DialogService) {}

  public confirmDiscard(): Promise<boolean> {
    return ConfirmDialog.show(this.dialogs, {
      title: "Discard changes?",
      message: "The current solution has unsaved changes. Discard them?",
      confirmLabel: "Discard",
    });
  }
}

// Registers the real host services the SolutionManagerService resolves by key:
// the local storage backend registry, the project-factory registry, and the
// discard-confirm dialog. Replaces the former SolutionSeams lambda bag with
// DI-resolved services (no seam object). Owned by the solution module — this
// app's host knowledge (which storage backend, which project type, the dialog
// copy) stays here, not in the generic bootstrap.
export class SolutionServicesRegistration {
  public static Register(services: IServiceContainer): void {
    services.register(
      SolutionManagerService.StorageRegistryKey,
      (p): IStorageProviderRegistry => p.getRequired(AppStorageProviderRegistry.Key),
    );
    services.register(
      SolutionManagerService.ProjectFactoryRegistryKey,
      (): IProjectFactoryRegistry => new TodlProjectFactoryRegistry(),
    );
    services.register(
      SolutionManagerService.DiscardConfirmerKey,
      (p): IDiscardConfirmer => new DialogDiscardConfirmer(p.getRequired(DialogService.Key)),
    );
    services.register(
      SolutionManagerService.PackageSourceKey,
      (p) => new IpcPackageSource(p.getRequired(RegistryClient)),
    );
  }
}
