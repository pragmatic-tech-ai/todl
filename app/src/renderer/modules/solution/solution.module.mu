// Solution module — a logical grouping of projects + cross-project settings as a
// rail capability. The domain services (SolutionManagerService, its settings
// registry) live in @pragmatic-tech-ai/todl; the app supplies the storage
// backend registry and the SolutionExplorerService presentation service (which
// configures the manager's host seams and projects the active solution into the
// side-panel view via DataTemplate[SolutionExplorerService]).
import SolutionManagerService from "@pragmatic-tech-ai/todl"
import SolutionSettingsRegistry from "@pragmatic-tech-ai/todl"
import AppStorageProviderRegistry from "../../services/storage/storage-provider-registry.ts"
import SolutionExplorerService from "./solution-explorer-service.ts"

module SolutionModule [ Name = "Solutions" ] {
    .services: {
        SolutionManagerService
        SolutionSettingsRegistry
        AppStorageProviderRegistry
        SolutionExplorerService
    }

    Capability [
        Name       = "Solutions",
        Icon       = @Solutions,
        ServiceKey = SolutionExplorerService
    ]
}
