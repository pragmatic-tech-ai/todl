/**
 * `ProjectInstaller` — installs a project's declared dependencies into its
 * node_modules (design: package-manager). A thin wrapper over `npm install`:
 * building a transitive dependency tree is npm's job, not the single-tarball
 * registry client's. The npm runner is an injected seam so the class unit-tests
 * without spawning npm.
 */
import { runNpm } from "./npm.js";

/** Runs npm with `args` in `cwd`, resolving with npm's exit code. */
export type NpmRunner = (args: readonly string[], cwd: string) => Promise<number>;

export class ProjectInstaller {
  private readonly run: NpmRunner;
  constructor(run: NpmRunner = runNpm) {
    this.run = run;
  }

  /** Install `directory`'s dependencies (delegates to `npm install`). */
  install(directory: string): Promise<number> {
    return this.run(["install"], directory);
  }
}
