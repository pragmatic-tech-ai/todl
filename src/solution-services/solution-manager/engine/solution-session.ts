import { Domain, type PackageSource, type PackageRef } from "../../../domain/domain.js";
import { Severity, DiagnosticCode, type Diagnostic } from "../../../compiler-services/diagnostics/diagnostic.js";

// The headless composition engine (renderer-side): loads each member package
// into one Domain via the injected PackageSource and collects load/bind failures
// as diagnostics. Holds the composed Domain for later querying. Node-free (it
// imports only Domain + diagnostics), so it is safe to export from the barrel and
// run in the renderer.
export class SolutionSession
{
  private readonly domain: Domain;
  private diagnostics: Diagnostic[] = [];

  constructor(source: PackageSource)
  {
    this.domain = new Domain(source);
  }

  get Domain(): Domain
  {
    return this.domain;
  }

  get Diagnostics(): readonly Diagnostic[]
  {
    return this.diagnostics;
  }

  // Load every member deps-first into the shared Domain. A member that fails to
  // resolve/load becomes one diagnostic; siblings still load.
  async compose(members: readonly PackageRef[]): Promise<void>
  {
    this.diagnostics = [];
    for (const ref of members)
    {
      try
      {
        await this.domain.load(ref);
      }
      catch (err)
      {
        const at = ref.version === undefined ? ref.model : `${ref.model}@${ref.version}`;
        this.diagnostics.push({
          code: DiagnosticCode.PackageUnresolved,
          severity: Severity.Error,
          message: `Cannot compose "${at}": ${(err as Error).message}`,
          span: null,
          node: null,
          path: null,
        });
      }
    }
  }
}
