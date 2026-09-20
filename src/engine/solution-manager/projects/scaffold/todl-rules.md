# TODL golden rules — the current language surface

The rules that trip up authors most, shared by every TODL project (architecture,
meta-model, library). Full reference: `.claude/todl-manual.md`.

- **Everything lives inside a `namespace`.** First line of every file:
  `namespace a.b.c {`, closed by a matching `}` at the end.
- **Every statement ends with `;`** — fields, assignments, relationships,
  imports. A missing `;` is the most common syntax error.
- **Identifiers are C-like** (`[A-Za-z_][A-Za-z0-9_]*`, no hyphens): **types**
  (concepts, primitives, taxonomies, annotations, enums, terms, classes) are
  **PascalCase** (`AppComponent`, never `app-component`) — except the prelude's
  **built-in primitives**, which are lowercase like `string` (`identifier`,
  `slug`, `resourceKey`); **members** (field names, relationship names,
  annotation params) match the surrounding files' casing (lowerCamel or
  lower_snake); **keywords** and **namespace** segments are lowercase.
- **References are bare names — no sigil**: `location`, `subnet.default`. Whether
  a value is a reference or a scalar is decided by the member's declared type
  (concept/taxonomy → reference, primitive → scalar). The characters `@` and
  `$` are reserved for Mural and are hard syntax errors in hand-authored TODL
  (`@name` appears only in serialized model dumps, never in source you write).
- **Cardinality is a suffix on the field's type** — bare = exactly one,
  `?` = optional (0..1), `[]` = many (0..N), `[+]` = one-or-more (1..N). There is
  **no** `[0..1]`, `[*]`, or `list<T>`; for a list of `bar` write `foo : bar [];`.
- **A field's TYPE is a single name** — a primitive, a taxonomy, or another
  concept; never an anonymous `object { … }`. Model structured data as a **nested
  concept**. On the *instance* side you may author that concept inline as a typed
  object literal — `field = SomeConcept { … }`; still typed, never bare `{ … }`.
- **Strings** are `"…"`; multi-line / raw strings are `"""…"""`.
- **Edge glyphs are author-declared, not built in.** `-->`, `==>`, `~>` are
  defined with `operator <glyph> : <Concept>(<from>, <to>);` (reified) or
  `operator <glyph> : <Concept>.<member>;` (relationship), then used between two
  bare endpoints (`a --> b;`) — as a statement or a value.
- **Annotations carry typed metadata.** Declare `annotation Name { param : type; }`
  (it may inherit: `annotation Sub : Base { … }`), then `annotate Name { param =
  value; }` inside a concept body, a relationship-member body, a taxonomy `term`,
  or a `package { … }` block. The prelude ships standard ones you use without
  declaring: `icon`/`label` (presentation), `wiki` (a Markdown page:
  `annotate wiki { path = "wiki/x.md"; }`), and `iconSource` (icon fallback order,
  on a relationship member).
- **Parent-less concepts extend the prelude's `Element`** (free `label` /
  `description`).
