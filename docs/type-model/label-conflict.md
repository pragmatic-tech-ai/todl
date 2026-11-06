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

## What an annotation-typed `label` field means at load time

It behaves exactly like a string field. Probing the tech-architecture meta-model plus `architectures/test_architecture` (instances `label = "Business User";` and so on), every instance of the 14 annotation-typed concepts stores `label` as a plain string attr, the same as `slot`/`technology` (string-typed) and as taxonomy terms: 100% of instances of actor, app_component, application, block, component, container, environment, location, network, resource_group, scenario, subnet, subscription and tenant carry a string `label` attr and no `label` edge. The loader does not treat the value as a reference to the annotation or as an annotation application. Cardinality is enforced the same way as for `string`: an `actor a1 { }` without a label yields `cardinality.required-missing ... tech_architecture.actor.label`, identical to `technology t1 { }`.

The `label: Business User` at `actor.todl:33` is not data: it is YAML text inside the `example = """..."""` string of an `authoring dict_form` block, so it exercises nothing.

Consumers of `label`:

- `src/solution-services/project-services/core/presentation-model.ts` (`LabelAnnotation = 'todl.label'`, `ResolveFacets`): reads the instance string attr `node.attrs['label']` first, and falls back to the concept's applied `annotate label { text = ... }` annotation (a different thing: an annotation applied to a concept, not a field). It never inspects the field's declared type.
- `src/compiler-services/emit/js-module.ts:216` and `src/graph-api/snapshot.ts` (`LabelField`): read the `label` attr / reflected field by name and require a string.
- The publish/reflect path has no `label`-specific handling.

No consumer depends on the field being annotation-typed. The only visible difference is in the reflected schema, where the field's declared type id is `todl.label` instead of `string`.

## Affected concepts (blast radius)

Only one meta-model under `test_projects/` declares concepts (`meta-models/tech-architecture`); `architectures/` and `libraries/` declare none. Concepts redeclaring an `Element` member:

- `label : label` (annotation-typed, 14): actor, app_component, application, block, component, container, environment, location, network, resource_group, scenario, subnet, subscription, tenant.
- `label : string` (required, 2): slot, technology.
- `description`: 0 concepts redeclare it.

Total: 16 concepts, all on `label`. Under R4 each would be an error ("redeclares inherited member `label`"); the 14 annotation-typed ones also retype the member.

Related, outside R4: `unit_label : label?;` at `concepts/billing-model.todl:12` uses the same annotation-as-type pattern on a differently named member. R4 does not touch it, but Option A's clean-up should retype it to `string?` for consistency.

## Options

**A. Make the meta-model conform to `Element` (drop the redeclarations).** Delete `label : label;` from the 14 concepts and `label : string;` from slot and technology; retype `unit_label` to `string?`. Everything inherits `label : string?`.

Does anything rely on `label` being required? Today the required `label` is enforced (`cardinality.required-missing`), so dropping it makes a missing label silently valid. In the instance data under `test_projects/architectures/` every instance of the 16 concepts carries a label (no missing-label cases found), so no existing model would change. Not verified: the roughly 178 test files that mention `label`, which I did not run against a modified meta-model; none of the concept files declares an invariant on `label`. If required labels matter, an invariant per concept (or a required `label` on `Element`, which would alter every meta-model) is needed instead. Because the annotation-typed field is stored as a string anyway, the only loss is the required cardinality and the odd declared type id `todl.label`; nothing depends on that type.

**B. Change `Element` to match the meta-model.** Drop `label` from `Element` (keep `description`), so each concept owns its `label`. Cost: the prelude no longer guarantees `label` on every concept, and `src/solution-services/project-services/core/scaffold/todl-manual.md` (line 77: "`Element` (which provides optional `label` and `description`) ... those two fields are always available") would be wrong and need rewriting; the annotation-typed fields stay. Retyping `Element.label` to `label` is not viable: it would make the root's label annotation-typed for every meta-model.

Status quo until decided: R4 enforcement against `Element`-inherited members stays off (`EnforceRootMemberRule=false`). This is the plan's default and leaves the model unchanged, not a third option.

Recommendation: A. The annotation-typed field is functionally a string, so `: label` reads as a mistaken type for `string`, but this is an inference from behavior, not something the source states; the author's intent should be confirmed. If required labels are wanted, keep them by adding per-concept invariants rather than redeclaring.
