# The `label : label` redeclaration conflict

Gate finding for the type-model aspects plan (Task 1). Decision needed before Task 5 enforces R4 (no redeclaring an inherited member) against members inherited from `Element`.

## What `label` resolves to

The prelude (`src/compiler-services/stdlib/prelude.todl`) declares two things named `label`:

- `annotation label { text : string?; }` (line 13), which resolves as `todl.label`.
- `concept Element { label : string?; description : string?; }`, the implicit root of every parent-less concept.

In `concepts/*.todl`, the line `label : label;` is a field declaration whose type name `label` resolves to the **annotation** `todl.label`. It is not a primitive, not a concept, and not unresolved. The tech-architecture meta-model loads with 0 diagnostics (45 files), so nothing today flags a field typed by an annotation.

Probe result (node ids as the loaded model stores them; cardinality codes One=0, Optional=1):

| Declaring concept | `label` field type | Cardinality |
|---|---|---|
| `todl.Element` | `string` | optional |
| 14 concepts (list below) | `todl.label` (an annotation node) | one (required) |
| `tech_architecture.slot` | `string` | one (required) |
| `tech_architecture.technology` | `string` | one (required) |

`Repository.effectiveSchema` lets the subtype's field win, so for those 16 concepts the effective `label` is a required `todl.label` (or a required `string` for slot and technology) and the root's optional `string?` is shadowed. Nothing in the model treats the annotation-typed field as a different member than `Element.label`; the two simply collide by name and the subtype wins.

## Affected concepts (blast radius)

Only one meta-model under `test_projects/` declares concepts (`meta-models/tech-architecture`); `architectures/` and `libraries/` declare none. Concepts redeclaring an `Element` member:

- `label : label` (annotation-typed, 14): actor, app_component, application, block, component, container, environment, location, network, resource_group, scenario, subnet, subscription, tenant.
- `label : string` (required, 2): slot, technology.
- `description`: 0 concepts redeclare it.

Total: 16 concepts, all on `label`. Under R4 each would be an error ("redeclares inherited member `label`"), and the 14 annotation-typed ones are also retyping the member.

## Options

**A. Make the meta-model conform to `Element` (drop the redeclarations).** Delete `label : label;` from the 14 concepts, and `label : string;` from slot and technology. Everything inherits `label : string?`. Cost: `label` becomes optional on those concepts (it is required today), so instances lacking a label stop being errors; if required labels matter, that needs an invariant per concept. The meaningless annotation-typed field disappears.

**B. Change `Element` to match the meta-model.** Drop `label` from `Element` (keep `description`), so each concept owns its own `label`. Cost: the prelude no longer guarantees `label` on every concept, tooling that assumes `Element.label` (the manual states `label` and `description` are always available) loses that, and the 14 `: label` fields stay typed by an annotation, which is probably unintended. Changing `Element.label` to type `label` instead is not viable: it would make the root's label annotation-typed for every meta-model.

A hybrid (R4 enforcement for `Element` members stays off, via `EnforceRootMemberRule=false`) is the plan's default until this is decided and leaves the model unchanged.

Recommendation: A, with the two `string` redeclarations removed too; the typo-like `: label` type is almost certainly a mistake for `string`.
