# TODL — language manual

The **Typed Object Definition Language** as accepted by the current
`@pragmatic-tech-ai/todl` compiler that Plexus runs on every keystroke. This
describes the surface the parser and validator actually enforce — not the older
YAML-flavoured or `list<T>` forms you may find in archived sources.

> If prose here ever disagrees with the **Problems** panel, the panel wins — it
> is the live compiler. Treat a clean panel as ground truth.

---

## 1. File shape

One `namespace` per file. Everything is declared inside it:

    namespace acme.ea.concepts
    {
        // imports first (optional), then declarations
        concept Component { … }
    }

- The namespace path is a dotted, lowercase path (`acme.ea.concepts`). By
  convention it mirrors the file's folder path.
- **`import` statements come first**, before any declaration:

      namespace acme.ea.model
      {
          import acme.ea.concepts;
          import acme.ea.taxonomies;

          model acme { … }
      }

  An import pulls another namespace's declarations into scope so you can refer to
  its concepts / primitives / taxonomies by bare name.

## 2. Lexical rules

- **Identifiers**: `[A-Za-z_] [A-Za-z0-9_]*` — C-like. No hyphens; `_` is
  allowed; no leading digit. By convention:
  - **Types** — `concept`, `primitive`, `taxonomy`, `annotation`, `enum`,
    `term`, and `class` names — are **PascalCase**: `AppComponent`,
    `ComponentCategory`, `Sku`. The **built-in** primitives shipped in the
    prelude are the exception: like `string`, they are **lowercase** —
    `identifier`, `slug`, `resourceKey`.
  - **Members** — field names, relationship names, and annotation parameters —
    use a consistent lower-case identifier convention: `lowerCamelCase`
    (`implementedBy`) or `lower_snake_case` (`implemented_by`) — both are valid
    C-like identifiers. **Match the casing already used in the surrounding
    files** rather than mixing styles.
  - **Keywords** (`concept`, `model`, `import`, `operator`, …) and **namespace**
    segments are lowercase.
- **Comments**: `// line` and `/* block */`. Both are ignored by the compiler.
- **Strings**: `"single line"`. **Raw / multi-line**: triple-quoted
  `"""…"""` (keeps newlines; use for `description` prose).
- **Numbers**: bare integers, e.g. `order = 1;`. (TODL has no distinct numeric
  *value* kind — a number stored on an annotation param serializes as its
  string form, e.g. `"1"`; coerce with `Number(...)` downstream if needed.)
- **References**: a bare `Name` or `dotted.Path` — there is no sigil. Whether a
  value is a reference (an edge) or a scalar is decided by the member's declared
  **type**: a field typed by a `concept` or `taxonomy` is a reference, a field
  typed by a primitive is a scalar. `@` and `$` are **reserved for Mural** and
  are hard errors in `.todl`. (You may see `@name` in a *serialized/exported*
  model dump — that is machine output, never hand-authored source.)
- **Operator glyphs**: author-declared infix symbols built from operator
  characters — `~>`, `-->`, `==>`, `->>`, etc. They are declared with the
  `operator` keyword (§7.1) and used as edge-making operators between two
  endpoints; they are NOT identifiers.
- **Every statement ends in `;`.** Blocks are delimited by `{ … }`, lists by
  `[ … ]`.

Every parent-less concept implicitly extends the prelude's root concept
**`Element`** (which provides optional `label` and `description`), so those two
fields are always available even when a concept does not redeclare them.

## 3. `concept` — a type in the meta-model

A concept is a first-class entity: the unit authors instantiate and the compiler
validates. It carries fields, relationships, and invariants.

    concept Component
    {
        description = """
            A first-class entity in the architecture — the unit that runs in a
            location. Naming is purpose-first; the technology choice lives in
            implementedBy, not in the name.
            """;

        id : identifier;
        label : string;
        category : ComponentCategory;
        implementedBy : identifier ?;

        relationship in -> Location;
        relationship realisedBy -> Technology [];

        invariant "Component ids are globally unique within the model.";
        invariant "category resolves to a known ComponentCategory term.";
    }

### Fields

    <name> : <Type> <cardinality>? ;

- `<Type>` is a **single name**: a primitive (`string`, `identifier`), a taxonomy
  (`ComponentCategory`), or another concept. A field's **type** is never an
  anonymous `object { … }` — structured data is modelled as a nested **concept**.
  (On the *instance* side you may then author that concept's data inline as a
  typed object literal — `field = SomeConcept { … }`; see §7.3.)
- `<cardinality>` is a suffix:

  | Suffix | Meaning        | Range |
  |--------|----------------|-------|
  | (none) | exactly one    | 1     |
  | `?`    | optional       | 0..1  |
  | `[]`   | many           | 0..N  |
  | `[+]`  | one or more    | 1..N  |

  So `realisedBy : Technology [];` is "zero or more technologies", and
  `implementedBy : identifier ?;` is "at most one".

### Inheritance

    concept AppComponent : Component { … }

`concept <Name> : <Parent>` extends a parent concept; the child inherits its
fields and relationships. Override an inherited field only with a
type-compatible narrowing.

### Relationships

    relationship <name> -> <Target> <cardinality>? ;

`<Target>` must be a concept name. Cardinality suffixes are the same as fields;
omit the suffix for exactly-one. `relationship realisedBy -> Technology [];`.

A relationship may carry a `{ … }` body, but that body may hold **only
`annotate` statements** — member-level annotations attached to the relationship
(a bare `field = value;` inside a relationship body is a syntax error). This is
how `iconSource` fallback order is declared per relationship (§6):

    relationship implementedBy -> Technology ? { annotate iconSource { order = 1; } }
    relationship realisedBy    -> Technology [] { annotate iconSource { order = 2; } }

### Invariants

Rules the validator enforces on instances. Two forms:

    invariant "Prose describing the rule the model must satisfy.";

    invariant
    {
        description = "Longer explanation of the same rule.";
        predicate   = this.implementedBy != none;
    }

The prose form is documentation the validator surfaces on violation. The
`predicate` form is an optional machine-checked expression — operators include
`==` `!=` `&&` `||` `implies`, the literals `this` and `none`, member access
(`this.field`), and `all` / `any … in …` comprehensions. When unsure of a
predicate's exact shape, write the prose form and confirm behaviour in the
Problems panel.

## 4. `primitive` — a base data type

    primitive Sku : string
    {
        description = "A stock-keeping unit code.";
        regex = "[A-Z0-9-]+";
    }

- `primitive <Name> : <base>` optionally names a base primitive (`string`,
  `integer`, …). The body carries a `description` and, for string primitives, a
  `regex` constraint. User-declared primitive names are PascalCase (`Sku`).
- Built-in primitives usable as a bare type without declaring them: `string`,
  `integer`, `boolean`, plus the prelude's **lowercase** `identifier`, `slug`,
  and `resourceKey`. (There is no `Label` primitive — a label is just a
  `string`.)

## 5. `taxonomy` — a controlled vocabulary (clabject classes)

A taxonomy *represents* one or more concepts; each `term` is a **class** of that
concept — a named subtype carrying fixed field values. A concept field typed by
the taxonomy takes one of its terms as a bare-name value.

    taxonomy ComponentCategory : represents Component
    {
        description = "The kinds of component the architecture recognises.";

        term AiAgent   { label = "AI Agent"; }
        term Database  { label = "Database"; }
        term Api       { label = "API"; }
    }

- `taxonomy <Name> : represents <Concept> ( , <Concept> )*` — the concept(s) whose
  instances draw their class from this taxonomy.
- `term <Id> { <name> = <value>; … }` — the single-concept form (valid when the
  taxonomy represents exactly one concept).
- `<Concept> <Id> { … }` — the **concept-led** term form, used when a taxonomy
  represents several concepts and each term must say which one it is a class of.
- **`uses <Taxonomy> ( , <Taxonomy> )*`** — an optional clause after `represents`
  that brings another taxonomy's terms into **bare scope** inside this taxonomy's
  term bodies, so you can reference them unqualified:

      taxonomy Servers : represents Technology uses Categories, Roles
      {
          Technology apiHost { category = PlatformApi; }   // PlatformApi from Categories, bare
      }

  Without `uses`, a cross-taxonomy term must be qualified; an unresolved one is
  `taxonomy.uses-undefined`, and a term ambiguous across two `uses` taxonomies is
  `taxonomy.ambiguous-bare-reference`.

A concept referencing it:

    concept Component { category : ComponentCategory; }

and an instance picks a term by name: `category = AiAgent;`. A `|`-composed set
of terms is allowed where the field is a flag set: `traits = Physical | Managed;`.

## 6. `annotation` — typed metadata on concepts and the package

An **annotation** is typed, author-declared metadata attached to a concept or to
the package as a whole. It is **static / type-level** — it carries no per-instance
data; the compiler validates it and downstream tools read it (Plexus's
presentation generator and the package manifest).

Declare an annotation type like a concept, with typed params:

    annotation Category { name : string; order : integer ?; }
    annotation Author   { name : string; email : string ?; }

An annotation may **inherit** from another annotation with the same `:` syntax as
concepts (single inheritance). The child inherits all of the base's params, and
an `annotate` of the child must supply every required param — inherited ones
included. Redeclaring an inherited param is `annotation.param-redeclared`; naming
a non-annotation base is `annotation.base-not-annotation`.

    annotation Visual   { icon : string; }
    annotation Detailed : Visual { badge : string; }   // has both icon and badge

Apply it with `annotate` — legal inside a `concept` body, a **relationship
member** body, a taxonomy `term` body, a `class` declaration, or a `package { }`
block (annotations are type-level; a concrete instance carrying `annotate` is
`annotation.invalid-target`) — giving each param a fixed value:

    concept Actor
    {
        annotate icon     { path = "resources/actor.svg"; }
        annotate Category { name = "actors"; order = 1; }

        label : string;
    }

    package
    {
        annotate Author { name = "Acme Corp"; email = "eng@acme.io"; }
    }

- Annotation **type** names are PascalCase; their **params** are camelCase, like
  every other type/member. The one exception: the well-known annotations tools
  switch on by name (`icon`, `label`, `toolbox`, `instance`, `iconSource`,
  `wiki`) are lowercase.
- Each annotation applies **at most once per target**; a repeat is an error.
- Params are **scalar** (string / integer / boolean). A required param must be
  given; an undeclared param is rejected.
- **Well-known annotations drive presentation.** `annotate icon { path = "…"; }`
  and `annotate label { text = "…"; }` on a concept feed the generated presentation
  (a raw `icon =` / `label =` attribute, where present, still takes precedence).
  Custom annotations are queryable and bindable in author presentation overrides.

### Standard annotations (from the prelude — no declaration needed)

These ship in the built-in prelude, so you `annotate` with them directly without
declaring them. Every param is optional:

    annotation MuralResource { key  : resourceKey ?; }
    annotation icon : MuralResource { path : string ?; }   // inherits `key`
    annotation label      { text    : string ?; }
    annotation toolbox    { visible : boolean ?; }
    annotation instance   { concept : identifier; via : identifier ?; }
    annotation iconSource { order   : number; }
    annotation wiki       { path    : string ?; }

- **`icon`** — a concept's presentation icon: `annotate icon { path =
  "resources/actor.svg"; }`. It inherits `key` from `MuralResource`.
- **`label`** — a display label: `annotate label { text = "Actor"; }`.
- **`iconSource`** — a **relationship-member** annotation giving the icon
  **fallback order**: when a concept defines no icon of its own, its icon is
  resolved from a related concept, trying members in ascending `order`. `order`
  is required; it is a number but stores as a string (§2). Declared in a
  relationship body (§3):
  `relationship implementedBy -> Technology ? { annotate iconSource { order = 1; } }`.
- **`wiki`** — a **concept-level** pointer to a Markdown page (project-relative),
  opened read-only from the concept's surfaces: `annotate wiki { path =
  "wiki/component.md"; }`.
- **`toolbox`** / **`instance`** are consumed by tooling; you rarely author them
  by hand.

## 7. Instances, classes, containment

Meta-model authors mostly write concepts/primitives/taxonomies; the *data*
(instances) is authored in architecture projects. You'll still read and
occasionally write instances:

    // model <id> : <meta-model> [uses <library> , … ] { concrete instances }
    model acme : acmeEa uses azureCatalog
    {
        Component businessAgent
        {
            label = "Business Agent";
            category = AiAgent;
            implementedBy = copilot;
        }

        Location azureWesteurope { label = "Azure West Europe"; }
    }

- **A concrete instance must live inside a `model` block.** A `model <id> :
  <meta-model> [uses <library>, …] { … }` is the sole carrier of instances; the
  `:` names the meta-model and `uses` lists the libraries it draws terms from
  (both are **namespace names** that must be in scope). A concrete instance
  declared at top level is an error (`instance.orphan`).
- A nested record inside a body expresses **containment** (the `Component` lives
  in the `model`).
- `<id>` is a bare camelCase identifier or a quoted string.
- `class <Concept> <id> { … }` declares a **class** (a partial, fixed-value
  definition). Classes are **exempt** from the model rule — they may sit at top
  level. A leaf points at one with `instanceof`:
  `Component x instanceof webApp { … }`.

### 7.1 Operators — author-declared edge glyphs

Edge glyphs like `-->` and `==>` are **not built in**; a meta-model **declares**
them with the `operator` keyword, binding a glyph to a concept that the edge
materializes. Two forms, declared at namespace level (outside any `model`):

    // Reified form — glyph binds a concept's two endpoint fields (from, to):
    operator --> : connector (from, to);

    // Relationship form — glyph binds a single relationship member:
    operator ~> : component.dependsOn;

- The glyph is an operator-character symbol (`~>`, `-->`, `==>`, `->>`, …), never
  an identifier. The declaration ends with `;`.
- The **reified** form (`operator glyph : Concept (fromField, toField);`)
  materializes a full reified instance of `Concept` (a `connector`, a `step`) with
  its two endpoint fields set. The **relationship** form
  (`operator glyph : Concept.member;`) adds a plain relationship edge.
- The tech-architecture meta-model, for example, declares
  `operator --> : connector (from, to);` and `operator ==> : step (src, dst);`.

### 7.2 Using an operator (as a statement or a value)

Once declared, use the glyph between two bare endpoint names. It works both as a
standalone edge statement inside a model body and as a **value** on the right of
`=` or inside an array — evaluating to the minted edge entity:

    model acme : acmeEa
    {
        component businessAgent { label = "Business Agent"; }
        component crmApi        { label = "CRM API"; }

        businessAgent --> crmApi;                  // standalone: materializes a connector
        flow = [ businessAgent --> crmApi ];       // as a value in an array

        businessAgent --> crmApi { latency = "low"; }   // optional { } adds attributes
    }

Terminate with `;` when standalone, or `,` / `]` inside an array.

### 7.3 Inline object literals

On the instance side a field's value can be a **typed** object literal — a nested
instance authored in place instead of referencing a named one. It must name its
concept type (a bare `{ … }` is rejected); it mints an addressable, contained
node:

    component orderService
    {
        slots = [
            Slot { id = prod; label = "Production"; environment = prodEnv; }
        ];
    }

Terminate with `;` (or `,` inside an array). The literal stays nested inside its
parent — it is not hoisted to a top-level instance.

## 8. Modifiers

`internal` and `sealed` may prefix a declaration
(`internal concept …`, `sealed concept …`) to mark visibility / finality. They
are optional; omit them unless a rule calls for them.

## 9. Diagnostics you'll see

The Problems panel reports these families (code → meaning):

- `syntax.*` — malformed source: unexpected/absent token, unterminated string,
  an unexpected character (often a stray `@` / `$`, or a missing `;`).
- `cardinality.required-missing` / `cardinality.too-many` /
  `cardinality.empty-not-allowed` — a field/relationship value count violates its
  cardinality suffix.
- `relationship.target-type` — a relationship `target` isn't the expected
  concept.
- `invariant.failed` — an instance violates a concept invariant.
- `class.override` / `class.binding-invalid` — a `class` illegally overrides a
  field, or an `instanceof` / meta-model binding doesn't resolve.
- `taxonomy.*` — a taxonomy represents no concept, a value doesn't resolve to a
  term, or a term names a concept the taxonomy doesn't represent.
- `instance.ambiguous-field-binding` — an assignment can't be matched to a single
  field.
- `instance.orphan` — a concrete instance is declared outside a `model` block.
- `model.binding-undefined` — a `model`'s `: <meta-model>` or a `uses` entry names
  a namespace no loaded module provides.
- `constructor.out-of-scope` — an instance's concept or class comes from a
  namespace the enclosing `model` doesn't bind (via `:` or `uses`).
- `annotation.unknown-param` / `annotation.duplicate` — an `annotate` gives a param
  the annotation didn't declare, or the same annotation is applied twice to one
  target. (An unknown annotation name is `reference.undefined`; a missing required
  param is `cardinality.required-missing`.)
- `annotation.invalid-target` — `annotate` on a target that can't carry it (e.g. a
  concrete instance). `annotation.base-not-annotation` / `annotation.param-redeclared`
  — an `annotation X : Base` names a non-annotation base, or re-declares an
  inherited param.
- `taxonomy.uses-undefined` / `taxonomy.ambiguous-bare-reference` — a `uses` entry
  names an unknown taxonomy, or a bare term is defined in more than one `uses`
  taxonomy.

Fix errors from the top down — a syntax error early in a file can cascade into
spurious later diagnostics. Re-check after each fix.

## 10. Quick reference

    namespace a.b.c { … }                       // one per file
    import a.b.d;                                // first in the body

    primitive Id : string { description = "…"; regex = "…"; }

    annotation Meta : Base { note : string ?; } // typed metadata type (may inherit)
    // Standard prelude annotations (no declaration): icon, label, toolbox,
    // instance, iconSource, wiki.

    concept Thing : Parent            // parent-less concepts extend `Element`
    {
        annotate icon { path = "resources/thing.svg"; }   // decorate the concept
        annotate wiki { path = "wiki/thing.md"; }         // read-only doc page
        description = """ … """;
        name  : string;             // exactly one
        tags  : SomeTaxonomy [];    // many
        owner : identifier ?;       // optional
        parts : Part [+];           // one or more
        relationship uses -> Other [] { annotate iconSource { order = 1; } }
        invariant "…";
    }

    taxonomy SomeTaxonomy : represents Thing uses Other { term A { label = "A"; } }

    operator --> : connector (from, to);         // declare an edge glyph

    package { annotate Author { name = "…"; } }  // package-level metadata

    model m : a.b.c uses lib                     // instances live in a model
    {
        Thing t { parts = [ Part { id = p1; } ]; }   // inline object literal
        a --> b;                                     // operator edge
    }
