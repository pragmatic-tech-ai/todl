# Authoring a meta-model

Companion to `.claude/todl-manual.md` (the language). This is about **what to put
in the model** and the path from source to published artifact.

## What a meta-model is

A meta-model is the schema layer of an architecture: the vocabulary that
*architecture* projects instantiate and *library* projects render. You define
the types (concepts), their allowed values (taxonomies), their base data shapes
(primitives), how they relate (relationships), and the rules they must satisfy
(invariants). Downstream projects don't redefine any of this — they bind to your
published meta-model and build on it.

## The three building blocks — how to choose

- **`primitive`** — a leaf data type constrained by a regex or a base type. Reach
  for one when you need a validated scalar (`Url`, `Email`, or the built-in
  lowercase `identifier`). Don't model an entity as a primitive.
- **`taxonomy`** — a closed, named set of values, where each value is a **class**
  of the concept it categorises (a clabject). Reach for one when a field's value
  comes from a controlled vocabulary that may carry its own fixed attributes
  (`ComponentCategory`, `LocationType`). Prefer a taxonomy over a free string
  whenever the set of valid values is known.
- **`concept`** — a first-class entity with identity, fields, relationships, and
  invariants. Reach for one for anything an author creates and connects
  (`Component`, `Location`, `Technology`).

Rule of thumb: if instances of it get an `id` and participate in relationships,
it's a **concept**; if it's a fixed vocabulary of kinds, it's a **taxonomy**; if
it's a validated scalar, it's a **primitive**.

## Shaping concepts

- **Purpose-first naming.** Name a concept for what it *is / does*, not for the
  technology behind it. Bind the technology through a relationship or an
  `implementedBy` field, not the name.
- **Singular concept, plural taxonomy.** A concept is a **singular** noun
  (`Technology`, `Component`, `Location`); the taxonomy that enumerates its
  classes is that **same noun in plural** and `represents` it —
  `Technology` → `taxonomy Technologies : represents Technology`. (A field-value
  taxonomy that names a categorization axis rather than a concept's classes —
  `ComponentCategory` — is the exception.)
- **Fields carry the data; relationships carry the links.** A value that
  *belongs to* the entity is a field; a *reference to another entity* is a
  relationship (`relationship in -> Location;`).
- **Pick cardinality deliberately.** Bare = exactly one, `?` = optional,
  `[]` = many, `[+]` = one-or-more. A required single-valued field is the default
  (no suffix) — reserve `?` for genuinely optional data.
- **Model structure as a nested concept, not an anonymous type.** A field's type
  is always a named primitive/taxonomy/concept — never `object { … }`. If a field
  needs structure, add a nested concept. (Authors can then fill it in inline as a
  typed object literal — `field = ThatConcept { … }` — on the instance side.) Keep
  concepts focused; a concept doing too much is a signal to split it.
- **Encode rules as invariants.** Anything the model must always satisfy
  ("component ids are globally unique", "a component's location must be one its
  technology supports") belongs in an `invariant`, in prose at minimum. The
  validator surfaces the prose when the rule is violated.

## Presentation metadata — annotations

Decorate a concept with **annotations** to control how it is presented and to
attach typed metadata a tool can read. The prelude ships the common ones, so you
`annotate` with them directly — no declaration needed (see the manual §6):

    concept Component
    {
        annotate icon { path = "resources/component.svg"; }
        annotate label { text = "Component"; }
        annotate wiki  { path = "wiki/component.md"; }

        relationship implementedBy -> Technology ? { annotate iconSource { order = 1; } }
        …
    }

- **`icon` and `label` are well-known** — the generated presentation reads them to
  draw each concept's chip (a raw `icon =` / `label =` attribute, where present,
  still wins). Put the concept's SVG under `presentation/` and point `path` at it.
- **`wiki`** attaches a Markdown page (project-relative `path`); an author opens it
  read-only from the concept's surfaces. Author the `.md` (or let an AI write it)
  under a `wiki/` folder.
- **`iconSource`** is a **relationship-member** annotation: when a concept has no
  icon of its own, its icon is borrowed from a related concept, trying members in
  ascending `order`. Declare it in the relationship body, not the concept body.
- **Custom annotations** are your own typed metadata (they may inherit via
  `annotation Sub : Base`); they ride along in the published model and are bindable
  from author presentation overrides.
- Package-level facts (author, license) go in a `package { annotate … }` block.

## Publishing identity

The project manifest (`project.json`) carries the `id` and `modelVersion` that
form the published coordinate `<id>@<modelVersion>`; there is no separate
descriptor record to author.

## Validate, then publish

1. **Author** `.todl` across as many files as makes sense — one namespace per
   file, folders grouping related declarations (`concepts/`, `taxonomies/`,
   `primitives/`).
2. **Validate continuously.** Plexus type-checks *every* `.todl` in the project
   together on each change; the **Problems** panel is the source of truth. A
   reference in one file resolving to a declaration in another is expected — the
   whole project is one compilation unit.
3. **Reach zero errors.** Warnings are advisory; errors block publishing.
4. **Publish** from the project menu. Publishing re-validates, then writes the
   compiled model (`model.json`) plus the raw sources into the shared meta-models
   backend under `<id>/<modelVersion>/`. **A project with any error publishes
   nothing** — fix them first.

## Working style

- Make one coherent change at a time and re-check the panel; a syntax error early
  in a file can cascade into misleading later diagnostics.
- Don't invent example instances or scaffold sample data unless asked — the
  author owns the model's content. When you need an input you don't have, ask.
