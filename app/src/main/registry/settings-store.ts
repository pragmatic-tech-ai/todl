/**
 * `SettingsStore` — the registry connection settings (URL, scope, org, GitHub API
 * base), persisted as JSON in `userData` (design §5). Defaults target GitHub
 * Packages under the `@pragmatic-tech-ai` scope. Pure `node:fs`; the `userData`
 * dir is injected so the unit test uses a temp dir.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Where the auth token comes from. */
export enum TokenSource {
  Stored = "stored",
  Env = "env",
}

export interface RegistrySettings {
  registry: string;
  scope: string;
  org: string;
  githubApi: string;
  tokenSource: TokenSource;
  /** The env-var name holding the token when `tokenSource === Env`. */
  tokenEnvVar: string;
}

const SETTINGS_FILE = "registry-settings.json";
const DEFAULTS: RegistrySettings = {
  registry: "https://npm.pkg.github.com",
  scope: "@pragmatic-tech-ai",
  org: "pragmatic-tech-ai",
  githubApi: "https://api.github.com",
  tokenSource: TokenSource.Stored,
  tokenEnvVar: "",
};

export class SettingsStore {
  private readonly path: string;

  constructor(private readonly userDataDir: string) {
    this.path = join(userDataDir, SETTINGS_FILE);
  }

  get(): RegistrySettings {
    if (!existsSync(this.path)) return { ...DEFAULTS };
    const stored = JSON.parse(readFileSync(this.path, "utf8")) as Partial<RegistrySettings>;
    return { ...DEFAULTS, ...stored };
  }

  update(partial: Partial<RegistrySettings>): void {
    const next = { ...this.get(), ...partial };
    mkdirSync(this.userDataDir, { recursive: true });
    writeFileSync(this.path, JSON.stringify(next, null, 2));
  }
}
