import { ServiceKey } from '@pragmatic-tech-ai/todl-runtime'

// The host seam for reading PROCESS environment variables — distinct from
// todl-runtime's IEnvironment (which exposes static facts like directories and
// platform, not arbitrary env vars). The package engine uses it for env-sourced
// connection tokens: a connection with TokenSource.Env reads its token from the
// named variable, and a host's connection editor lists candidate names. The app
// supplies a concrete over process.env; a test supplies a fake map. Resolved
// OPTIONALLY — without it, an env-sourced token degrades to empty.
export interface IEnvironmentVariables
{
    Get(name: string): string | undefined
    // Every set variable name, for a "pick an env var" affordance.
    Names(): readonly string[]
}

// The container key the environment-variables provider registers under (standalone
// const, so a module's `.services:` markup can name it in the `Impl -> Token` form).
export const EnvironmentVariablesKey =
    new ServiceKey<IEnvironmentVariables>('PackageEnvironmentVariables')
