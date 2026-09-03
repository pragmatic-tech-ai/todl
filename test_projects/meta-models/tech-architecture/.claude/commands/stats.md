---
description: Print structural statistics about this TODL meta-model (files, namespaces, declaration counts, taxonomy sizes, top concepts).
argument-hint: (no args)
---

Use the Task tool to dispatch the `meta-model-stats` subagent. Pass an empty
task description (the agent walks the whole project).

When the subagent returns its markdown summary, relay it verbatim to the user.
Do not add commentary, do not re-format, do not persist anything to disk.
