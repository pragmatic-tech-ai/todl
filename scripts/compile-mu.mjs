// Compile TODL's .mu → .mu.js via the mural compiler CLI. Resolves the CLI by
// probing candidate node_modules (package-local, then a hoisted parent), so it
// works regardless of how @pragmatic-tech-ai/mural is linked. TODL authors
// headless composition modules (a plain `module NAME { .services: … }` → a
// `Module`) in .mu, keeping module wiring uniform with the rest of the workspace
// instead of hand-written TypeScript.
//
// We import `runCLI` and call it directly rather than spawning the CLI as a
// subprocess: mural is SYMLINKED into TODL's node_modules, and the CLI's
// "run as main" guard compares process.argv[1] (the symlink path) against
// import.meta.url (the real path) — they differ through a symlink, so the
// subprocess would no-op. Calling the exported entry point sidesteps that guard.
import { globSync, existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const CLI_REL = '@pragmatic-tech-ai/mural/dist/tooling/cli.js'
const cliPath = [
    new URL(`../node_modules/${CLI_REL}`, import.meta.url),        // TODL/node_modules
    new URL(`../../node_modules/${CLI_REL}`, import.meta.url),     // hoisted parent
].map(fileURLToPath).find(existsSync)
if (cliPath === undefined) {
    console.error('[compile-mu] cannot find mural CLI')
    process.exit(1)
}
const files = globSync('src/**/*.mu')
if (files.length === 0) {
    console.warn('[compile-mu] no .mu files under src/')
    process.exit(0)
}
const { runCLI } = await import(pathToFileURL(cliPath).href)
process.exit(runCLI(['compile', ...files]))
