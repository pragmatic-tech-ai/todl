import { type IProjectFactory } from "@pragmatic-tech-ai/todl";
import { type IStorage } from "@pragmatic-tech-ai/todl-runtime";

// The project TYPE id a solution member carries to route back to this factory
// (via Mural's ProjectFactoryRegistry). Distinct from a package manifest's own
// `type` field.
export const TODL_PACKAGE_TYPE = "todl-package";

const MANIFEST_FILE = "project.plexus";

// A live todl-package project: a name + the storage it is rooted at. Minimal on
// purpose — the compile/publish flow (readProject) operates over the same folder
// when the member is acted on; the solution only needs an opened handle.
export class TodlPackageProject {
    constructor(
        public readonly Name: string,
        public readonly Storage: IStorage,
    ) {}
}

// The `todl-package` project type: wraps a folder holding a `project.plexus`
// manifest + .todl sources as a proper project the SolutionManager can open,
// create, and save via IStorage.
export class TodlPackageProjectFactory implements IProjectFactory {
    async createProject(storage: IStorage, name: string): Promise<unknown> {
        await storage.WriteText(MANIFEST_FILE, TodlPackageProjectFactory.manifestJson(name))
        return new TodlPackageProject(name, storage)
    }

    async openProject(storage: IStorage): Promise<unknown> {
        const raw = JSON.parse(await storage.ReadText(MANIFEST_FILE)) as { name?: unknown }
        const name = typeof raw.name === "string" ? raw.name : "Package"
        return new TodlPackageProject(name, storage)
    }

    async saveProject(project: unknown, storage: IStorage): Promise<void> {
        const name = project instanceof TodlPackageProject ? project.Name : "Package"
        await storage.WriteText(MANIFEST_FILE, TodlPackageProjectFactory.manifestJson(name))
    }

    private static manifestJson(name: string): string {
        return JSON.stringify({ type: TODL_PACKAGE_TYPE, name, version: 1 }, null, 2)
    }
}
