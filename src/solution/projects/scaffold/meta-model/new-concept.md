---
description: Scaffold a new TODL concept skeleton in this meta-model project
argument-hint: <ConceptName>
---

Add a new TODL concept named `$ARGUMENTS` to this meta-model.

If `$ARGUMENTS` is empty, ask for the concept name first (PascalCase),
then proceed.

1. Choose the target `.todl` file. Keep one `namespace` per file, mirroring its
   folder path; create a new file under the right namespace if none fits.
2. Inside that namespace, add a concept skeleton:

       concept $ARGUMENTS
       {
           description = """
               <one paragraph: what this concept is, and the rule it enforces>
               """;

           id : identifier;
           label : string;
           // fields:        <name> : <Type> <card>;   card = (none) | ? | [] | [+]
           // relationships: relationship <name> -> <Target> <card>;
       }

3. Type every field with a primitive, a taxonomy, or another concept — never an
   anonymous `object { … }`. For structured data, add a nested concept (authors
   can fill it in inline as a typed literal, `field = ThatConcept { … }`).
4. Add `invariant "…";` lines for any rule the validator should enforce.
5. Optionally decorate the concept: `annotate icon { path = "…"; }`,
   `annotate wiki { path = "wiki/<name>.md"; }`, or, for icon fallback, an
   `annotate iconSource { order = N; }` inside a relationship body.
6. Follow `.claude/todl-manual.md` for exact syntax: bare-name references (no
   sigil; `@`/`$` are errors), C-like identifiers matching the surrounding files'
   casing, and a `;` at the end of every statement. Parent-less concepts extend
   the prelude's `Element` (free `label` / `description`).
7. Save, then read the **Problems** panel. Resolve every diagnostic before you
   consider the concept done.
