// Pure field SPECS for the NPM registry setting bag — no Mural dependency, so the
// security invariant (no literal-token field) is unit-testable under the app's
// `tsx --test` (which can't statically load the file:-symlinked Mural/todl).
// SECURITY: only the token SOURCE (stored | env) and env-var NAME — never a
// literal token. `kind` is a local tag mapped to Mural's SettingKind in the bag.

export interface NpmFieldSpec {
    key: string
    label: string
    kind: "string" | "choice"
    default: string
    choices?: readonly string[]
}

export const NPM_REGISTRY_BAG_ID = "npm-registry"
export const NPM_REGISTRY_BAG_TITLE = "NPM Registry"

export const NPM_REGISTRY_FIELDS: readonly NpmFieldSpec[] = [
    { key: "registry", label: "Registry URL", kind: "string", default: "https://npm.pkg.github.com" },
    { key: "scope", label: "Scope", kind: "string", default: "" },
    { key: "org", label: "Organization", kind: "string", default: "" },
    { key: "tokenSource", label: "Token source", kind: "choice", default: "env", choices: ["stored", "env"] },
    { key: "tokenEnvVar", label: "Token env var", kind: "string", default: "PACKAGES_TOKEN" },
]
