import { type IServiceContainer } from "@pragmatic-tech-ai/mural/runtime";
import { DialogService } from "@pragmatic-tech-ai/mural/framework";
import { SolutionManagerService, type SolutionSeams } from "@pragmatic-tech-ai/todl";
import { AppStorageProviderRegistry } from "../../services/storage/storage-provider-registry.js";
import { ConfirmDialog } from "../../services/dialogs/confirm-dialog.js";
import { TodlPackageProjectFactory, TODL_PACKAGE_TYPE } from "./todl-package-project-factory.js";

// Registers the host seams the package's SolutionManagerService resolves from
// the container (under SolutionManagerService.SeamsKey): the local storage
// backend, the project-factory map, and the discard-confirm dialog. Owned by the
// solution module — not the generic bootstrap — so this app's host knowledge
// (which storage backend, which project type, the dialog copy) stays here.
export class SolutionSeamsRegistration {
  public static Register(services: IServiceContainer): void {
    services.register(SolutionManagerService.SeamsKey, (p): SolutionSeams => {
      const storage = p.getRequired(AppStorageProviderRegistry.Key);
      const dialogs = p.getRequired(DialogService.Key);
      const factory = new TodlPackageProjectFactory();
      return {
        storageForFolder: (folder) =>
          storage.Create(AppStorageProviderRegistry.DefaultBackendId, folder),
        factoryFor: (type) => (type === TODL_PACKAGE_TYPE ? factory : undefined),
        confirmDiscard: () =>
          ConfirmDialog.show(dialogs, {
            title: "Discard changes?",
            message: "The current solution has unsaved changes. Discard them?",
            confirmLabel: "Discard",
          }),
      };
    });
  }
}
