import { type IStorage } from "@pragmatic-tech-ai/todl-runtime";
import { DiagnosticSink, Severity } from "../../build-system-core/diagnostic-sink.js";
import { type ProjectEvent, ProjectEventKind } from "../generators/project-events.js";
import { ArchitectureProjectFactory } from "./architecture-project-factory.js";

// Migrates the OLD architecture layout (the app UI generated into `generated/app.mu`)
// to the editable-source layout (`src/app.mu`). The old file is an `Application` whose
// StackPanels bind through the DataContext the entry sets, so it stays valid verbatim —
// it is MOVED, never regenerated. Idempotent and conflict-safe: it only acts when the old
// file is present AND the new one absent; if both exist nothing is touched and a warning
// is reported. It must run BEFORE the generator backfill on Opened, otherwise the
// AppGenerator would scaffold a fresh `src/app.mu` first and the old UI would be refused.
export class ArchitectureProjectMigration
{
    private static readonly OldAppPath = "generated/app.mu";
    private static readonly NewAppPath = "src/app.mu";
    private static readonly ConflictMessage =
        "Both generated/app.mu and src/app.mu exist; left both untouched. Merge generated/app.mu into src/app.mu manually and delete the old file.";
    private static readonly DiagnosticSource = "ArchitectureProjectMigration";

    public constructor(private readonly diagnostics: DiagnosticSink = new DiagnosticSink())
    {
    }

    // Bus handler: migrates an opened architecture project; inert for every other event/type.
    public async Handle(event: ProjectEvent): Promise<void>
    {
        if (event.Kind === ProjectEventKind.Opened && event.ProjectType === ArchitectureProjectFactory.ProjectType)
        {
            await this.Run(event.Project);
        }
    }

    public async Run(project: IStorage): Promise<void>
    {
        if (!(await project.Exists(ArchitectureProjectMigration.OldAppPath)))
        {
            return;
        }

        if (await project.Exists(ArchitectureProjectMigration.NewAppPath))
        {
            this.diagnostics.Report({
                severity: Severity.Warning,
                message: ArchitectureProjectMigration.ConflictMessage,
                source: ArchitectureProjectMigration.DiagnosticSource,
            });
            return;
        }

        const content = await project.ReadText(ArchitectureProjectMigration.OldAppPath);
        await project.WriteText(ArchitectureProjectMigration.NewAppPath, content);
        await project.Delete(ArchitectureProjectMigration.OldAppPath);
    }
}
