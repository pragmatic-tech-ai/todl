# Library project (TODL)

This project defines a **library** in **TODL** — a set of `taxonomy` terms
(technology classes) authored **against a bound meta-model**, plus the visuals
that render them. You (the agent) help author and refine it. When the project
validates clean, the author **publishes** it to the shared libraries backend,
where architecture projects consume it as `<id>@<libVersion>`.

## What you edit

`.todl` files (taxonomies of classes) and their `presentation/` + `visuals/`
resources. Plexus validates every `.todl` in the project against the bound
meta-model, live: diagnostics appear in the **Problems** panel. **Publishing is
blocked while any error remains.** Example instances belong under `samples/` and
are excluded from the published taxonomy.

## Golden rules — the current TODL surface

The rules that trip up authors most live in **`.claude/todl-rules.md`** (shared by
every TODL project), with the full language reference in **`.claude/todl-manual.md`**.
A library adds one habit: a `taxonomy T : represents <Concept> { … }` whose terms
are **classes** of a meta-model concept, each optionally carrying `annotate icon`
/ `annotate wiki` for presentation.

## Workflow

1. Edit a `.todl` taxonomy.
2. Watch the **Problems** panel — validation runs against the bound meta-model.
3. Clear every **error** (warnings are advisory).
4. When clean, the author runs **Publish** → the compiled model + sources +
   resources are written to the libraries backend.

## Go deeper

- `.claude/todl-rules.md` — the shared TODL golden rules.
- `.claude/todl-manual.md` — the full language reference.
