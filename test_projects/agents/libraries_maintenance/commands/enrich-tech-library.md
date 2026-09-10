---
description: Consume a discovery-report and produce the <lib>.technology-library.model file plus icons, wiki stubs, and an enrichment-report.
argument-hint: <lib-name> [--icon-dir <path>] [--apply-updates]
---

Use the Task tool to dispatch the `tech-library-enricher` subagent. Pass `$ARGUMENTS` verbatim as the subagent's task description.

The subagent will:
1. Parse args (lib-name + optional --icon-dir + optional --apply-updates). If no --icon-dir flag, read `icon-fallback-dir:` from `technology_library/<lib-name>/maintenance/config.yaml`.
2. Read `technology_library/<lib-name>/maintenance/<lib-name>.discovery-report.md` (error if missing).
3. Resolve locations and technologies into TODL entries.
4. Download icons via the four-step ladder.
5. Write wiki stubs (Purpose drafted, Trade-offs left empty).
6. Emit the library file (additive; read-only on existing entries unless --apply-updates).
7. Emit the enrichment-report to `technology_library/<lib-name>/maintenance/<lib-name>.enrichment-report.md`.

After the subagent finishes, summarise its result (counts, low-confidence flag count, icon-source distribution). Tell the user to grep the enrichment-report for `[low-confidence]` to find every decision needing review. Do not modify any of the produced files from the main session.
