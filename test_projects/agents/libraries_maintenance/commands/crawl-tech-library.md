---
description: Crawl a vendor's product catalogue and produce a discovery-report for tech-library-enricher.
argument-hint: <lib-name> [--seed <url> ...]
---

Use the Task tool to dispatch the `tech-library-crawler` subagent. Pass `$ARGUMENTS` verbatim as the subagent's task description.

The subagent will:
1. Parse args (lib-name + optional --seed URLs). If no --seed flags, read `seeds:` from `technology_library/<lib-name>/maintenance/config.yaml`.
2. Walk the seed pages and identify technology entries.
3. Capture observations into `technology_library/<lib-name>/maintenance/<lib-name>.discovery-report.md`.
4. Archive any prior discovery-report under `technology_library/<lib-name>/maintenance/discovery-reports/<iso-timestamp>.md`.
5. Report back with counts and any errors.

After the subagent finishes, summarise its result to the user (lib name, report path, counts). Do not modify the report further from the main session.