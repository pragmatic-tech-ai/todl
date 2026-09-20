import { type Diagnostic } from '../../diagnostics/diagnostic.js'

// Ambient feedback the engine emits and the host displays — status/progress/
// diagnostics that are NOT a change to a Manager's own model. A UI host renders
// these on the status strip / Problems dock; a test records them; a CLI writes to
// the console. Resolved OPTIONALLY by the engine — a headless batch may run without
// one. State-change is NOT here: that is the Manager's own PropertyChanged.
export interface INotificationService
{
    Status(message: string): void
    Progress(operation: string, done: number, total: number): void
    Report(owner: string, diagnostics: readonly Diagnostic[]): void
}
