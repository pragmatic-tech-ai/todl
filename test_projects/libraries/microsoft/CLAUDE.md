# microsoft — library project

Technology + location library for the Microsoft stack (Azure, M365,
Power Platform), authored in `microsoft.todl` against the
`tech-architecture` meta-model (`../../meta-models/tech-architecture/`).
Consumed by architecture projects that `import libraries.microsoft;`
and add `microsoft-tech` to their model's `uses` clause.

## TODL gotchas discovered while authoring

Non-obvious compiler behaviors that aren't in the manual. Read the
memory index and then the individual files as relevant:

- `~/.claude/projects/C--Users-Eugene-Projects-plexus-tests-libraries-microsoft/memory/MEMORY.md`

Topics covered so far: taxonomy `uses` clause required on `taxonomy`
headers; `step` shorthand only binds to `src` / `dst` (not `from` /
`to`); nested `slot` ids are globally scoped despite the prose invariant.
