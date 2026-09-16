# CLAUDE.md

TODL — `@pragmatic-tech-ai/todl`, the TypeScript rebuild of the typed-object
language: language + meta-models + model compiler (reflective typed graph,
load → validate → emit). ESM, strict tsconfig; tests via
`tsx --conditions=development --test "src/**/*.test.ts"`.

## Work tracking

All work — tasks, features, bugs, and design notes — is tracked in the GitHub
Project **Architecture Agentic Suite** (org `pragmatic-tech-ai`, project number
`1`). Work descriptions, backlogs, and TODO lists are **not** stored in local
files anymore. Read and update the backlog with the `gh` CLI:

- List items: `gh project item-list 1 --owner pragmatic-tech-ai`
- Add an item: `gh project item-create 1 --owner pragmatic-tech-ai --title "…" --body "…"`

When you finish or pick up work, reflect it in the Project rather than a local
note.

**Specs & plans too.** Design specs and implementation plans (superpowers
`brainstorming` / `writing-plans` output) live in the Project, not under
`docs/superpowers/`. Create each as an item with the **Kind** field
(`PVTSSF_lADOE0Zc984Biu4ozhhmtQM`) set to `Spec` or `Plan`. The CLI `--body`
overflows Windows' arg limit on large docs — create via GraphQL, reading the
body from a file:
`gh api graphql -f query='mutation($p:ID!,$t:String!,$b:String!){addProjectV2DraftIssue(input:{projectId:$p,title:$t,body:$b}){projectItem{id}}}' -f p=PVT_kwDOE0Zc984Biu4o -f t="[Repo] title" -F b=@file.md`.

## Testing

- **Every test file lives in a `tests/` subfolder next to the code it
  exercises** — `src/model/tests/builder.test.ts`, never
  `src/model/builder.test.ts`. The runner globs `src/**/*.test.ts` either way,
  so this is organizational: keep source directories free of test files.

## View models extend Observable

New view-model classes derive from `Observable` (the lightweight INPC root),
not `MuralBase`. Reserve `MuralBase` for the few things that genuinely need the
dependency-property system. Default a VM to `Observable` unless told otherwise.
