// Package Compiler module — compile a project directory into a package and
// publish it, as a rail capability. Its service (PackageCompilerService) drives
// the open/compile/publish flow; the side panel renders the actions and the
// central content host shows the resulting CompiledPackage.
import PackageCompilerService from "./package-compiler-service.ts"

module PackageCompilerModule [ Name = "Package Compiler" ] {
    .services: { PackageCompilerService }

    Capability [
        Name       = "Compiler",
        Icon       = @Compiler,
        ServiceKey = PackageCompilerService
    ]
}
