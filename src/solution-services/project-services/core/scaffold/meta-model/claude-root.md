# Meta-model project (TODL)

This project defines a **meta-model** in **TODL** — the concepts, primitives,
taxonomies, relationships, and invariants that downstream *architecture* and
*library* projects build on. You (the agent) help author and refine it. When the
whole project validates clean, the author **publishes** it to the shared
meta-models backend, where other projects consume it as `<id>@<modelVersion>`.

## What you edit

`.todl` files. Each file is one `namespace <dotted.path> { … }` holding
`primitive` / `concept` / `taxonomy` declarations. Plexus validates **every `.todl` in the project
together**, live: diagnostics appear in the **Problems** panel at the bottom of
the window. **Publishing is blocked while any error remains.**

## Golden rules — the current TODL surface

The rules that trip up authors most live in **`.claude/todl-rules.md`** (shared by
every TODL project), with the full language reference in **`.claude/todl-manual.md`**.
Read `todl-rules.md` before authoring: namespaces, the trailing `;`, C-like
identifiers, bare references (no `@`/`$`), `?`/`[]`/`[+]` cardinality,
author-declared operator glyphs, typed inline object literals, and the standard
prelude annotations (`icon`/`label`/`wiki`/`iconSource`).

One meta-model habit on top of those: **concepts are singular nouns, their
taxonomy is that noun in plural** — `Technology` → `taxonomy Technologies :
represents Technology`. See `.claude/meta-model-guide.md`.

## Workflow

1. Edit a `.todl` file.
2. Watch the **Problems** panel — validation runs across the whole project on
   every change.
3. Clear every **error** (warnings are advisory). Frequent ones: a missing `;`,
   an unresolved reference, a cardinality violation, or a `relationship` whose
   `target` isn't a concept.
4. When the project is clean, the author runs **Publish** from the project menu →
   the compiled model plus the raw sources are written to the meta-models
   backend.

## Asking the user

When a decision is genuinely the user's — which of several valid modellings to
take, an ambiguous name, a scope call — prefer the **`ask_user_question`** tool
over guessing. It shows the user a choice card (1–4 questions, single/multi-select,
with a free-text "Other") right in the chat and returns their pick. Use it for real
forks, not for confirmations you can infer or trivial defaults.

## Go deeper

- `.claude/todl-rules.md` — the shared TODL golden rules (read this first).
- `.claude/todl-manual.md` — the full language reference (declarations,
  cardinality, values, edges, diagnostics), grounded in the current parser.
- `.claude/meta-model-guide.md` — how to shape a meta-model: concepts vs
  taxonomies vs primitives, invariants, and the publish contract.
- `/new-concept <name>` — scaffold a concept skeleton
  (`.claude/commands/new-concept.md`).
