import { FakeStorage, type IStorage } from '@pragmatic-tech-ai/todl-runtime';
import { type IBuildStorageProvider, type OpenedOutput } from '../build-system-core/index.js';

// Each build gets a fresh in-memory sandbox and promotes into one in-memory
// output; nothing persists to disk — the publish flavor's terminal action
// pushes the staged package straight to the registry, so the promoted output
// is scratch and discarded with the process.
export class InMemoryBuildStorage implements IBuildStorageProvider
{
    private static readonly OutputPath = 'memory://build';

    private readonly output = new FakeStorage();

    public CreateSandbox(): Promise<IStorage>
    {
        return Promise.resolve(new FakeStorage());
    }

    public DeleteSandbox(_sandbox: IStorage): Promise<void>
    {
        return Promise.resolve();
    }

    public OpenOutput(_outputName: string): Promise<OpenedOutput>
    {
        return Promise.resolve({ Storage: this.output, Path: InMemoryBuildStorage.OutputPath });
    }
}
