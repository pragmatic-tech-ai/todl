# Task 10 report

Added ArchitectureProjectMigration (Run(project: IStorage, optional DiagnosticSink via ctor; Handle(event) for the bus). Moves generated/app.mu -> src/app.mu only when old exists and new absent; if both exist, leaves both and reports a Warning; no-op otherwise. Idempotent.

Wiring: ProjectSystemComposer subscribes migration.Handle on the ProjectEvents bus BEFORE scheduler.Handle. Raise awaits subscribers in registration order, so migration finishes before Backfill. Verified by temporarily swapping order: 2 tests fail. Inert for non-architecture types / non-Opened events.

Tests: architecture-project/tests/architecture-project-migration.test.ts, 7 pass (unit: move, idempotent, conflict-safe, no-op; composed Opened: old content in src/app.mu + main.ts/data.ts backfilled + model.ts intact, second Opened no-op, existing src/app.mu preserved).

Full suite: 1637 tests, 1636 pass, 1 fail. The failure ("a build with neither required file generated fails fast..." in the end-to-end test_architecture html-bundle test) is PRE-EXISTING: it fails identically with my changes stashed.

## Fail-fast fixture fix

The copiedArchitectureFixture helper in html-bundle.test.ts now also deletes src/main.ts and src/app.mu from the copy (it already removed generated/, covering model.ts and data.ts), so every html-bundle test starts without required content. Fail-fast assertions unchanged; committed fixture untouched. html-bundle test file: 9/9 pass. Full suite: tests 1637, pass 1637, fail 0, cancelled 0, skipped 0.

