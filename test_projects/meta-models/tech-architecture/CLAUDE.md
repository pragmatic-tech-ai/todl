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

Full reference: `.claude/todl-manual.md`. The rules that trip up authors most:

- **Everything lives inside a `namespace`.** First line of every file:
  `namespace a.b.c {`, closed by a matching `}` at the end.
- **Every statement ends with `;`** — fields, assignments, relationships,
  imports. A missing `;` is the most common syntax error.
- **Identifiers are lowercase kebab-case**: `app-component`, never `AppComponent`
  or `app_component`. Concept names, field names, and file stems too.
- **Concepts are singular nouns; their taxonomy is that noun in plural.** A
  `concept` names a single thing (`technology`, `component`, `location`); the
  `taxonomy` that enumerates that concept's classes is the **same noun,
  pluralized**, and `represents` it — e.g.
  `taxonomy technologies : represents technology { … }`. (Still kebab-case:
  `access-policy` → `taxonomy access-policies : represents access-policy`.)
- **References use `&`**: `&location`, `&subnet.default`. The characters `@` and
  `$` are reserved for Mural and are hard syntax errors in TODL.
- **Cardinality is a suffix on the field's type** — bare = exactly one,
  `?` = optional (0..1), `[]` = many (0..N), `[+]` = one-or-more (1..N). There is
  **no** `[0..1]`, `[*]`, or `list<T>` in the current surface; for a list of
  `bar` write `foo : bar [];`.
- **No inline object types.** A field's type is a single name — a primitive, a
  taxonomy, or another concept. Model structured / nested data as a **nested
  concept**, not `object { … }`.
- **Strings** are `"…"`; multi-line / raw strings are `"""…"""`.
- **Annotations carry typed metadata.** Declare an `annotation name { param :
  type; }`, then `annotate name { param = value; }` inside a concept body (or a
  `package { … }` block) to attach it. Well-known `annotate icon { path = "…"; }`
  and `annotate label { text = "…"; }` drive the concept's generated presentation.
  See the manual §6.

## Workflow

1. Edit a `.todl` file.
2. Watch the **Problems** panel — validation runs across the whole project on
   every change.
3. Clear every **error** (warnings are advisory). Frequent ones: a missing `;`,
   an unresolved `&ref`, a cardinality violation, or a `relationship` whose
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

- `.claude/todl-manual.md` — the full language reference (declarations,
  cardinality, values, edges, diagnostics), grounded in the current parser.
- `.claude/meta-model-guide.md` — how to shape a meta-model: concepts vs
  taxonomies vs primitives, invariants, and the publish contract.
- `/new-concept <name>` — scaffold a concept skeleton
  (`.claude/commands/new-concept.md`).

## TODL gotchas discovered while authoring

Non-obvious compiler behaviors that aren't in the manual. Read the
memory index and then the individual files as relevant:

- `~/.claude/projects/C--Users-Eugene-Projects-plexus-tests-libraries-microsoft/memory/MEMORY.md`

Topics covered so far: taxonomy `uses` clause required on `taxonomy`
headers; `step` shorthand only binds to `src` / `dst` (not `from` /
`to`); nested `slot` ids are globally scoped despite the prose invariant.
