# Architecture project (TODL)

This project holds an **architecture model** in **TODL** — the instance tier:
concrete components, locations, and technologies, authored **against a bound
meta-model and a set of libraries**. You (the agent) help author and refine it.
An architecture project is a terminal consumer — it binds bases but publishes
nothing.

## What you edit

`.todl` files (the instance model) and `.diagram` files (views over it). Plexus
validates every `.todl` in the project against the bound meta-model + libraries,
live: diagnostics appear in the **Problems** panel.

## Golden rules — the current TODL surface

The rules that trip up authors most live in **`.claude/todl-rules.md`** (shared by
every TODL project), with the full language reference in **`.claude/todl-manual.md`**.
On the instance side you mostly create typed instances of the meta-model's
concepts and connect them with the meta-model's declared operator glyphs
(`a --> b;`); you may author nested structure inline as a typed object literal
(`field = SomeConcept { … }`).

## Workflow

1. Edit a `.todl` model file (or a `.diagram` view).
2. Watch the **Problems** panel — validation runs against the bound bases.
3. Clear every **error** (warnings are advisory).

## Go deeper

- `.claude/todl-rules.md` — the shared TODL golden rules.
- `.claude/todl-manual.md` — the full language reference.
