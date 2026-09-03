/**
 * The one remaining npm shell-out (design: todl-package-manager §3 + registry
 * client). Publishing now goes over the wire via {@link NpmRegistry}; npm is used
 * only for `install`, because building a transitive `node_modules` tree is
 * dependency resolution — npm's job, not the single-tarball registry client's.
 */
import { spawn } from "node:child_process";

/** Run npm with `args` in `cwd`. Resolves with npm's exit code (0 = success);
 *  rejects only if npm could not be spawned. */
export function runNpm(args: readonly string[], cwd: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const child = spawn("npm", [...args], {
      cwd,
      stdio: "inherit",
      // npm is a shell script on Windows; spawn needs a shell to find it.
      shell: process.platform === "win32",
    });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 0));
  });
}
