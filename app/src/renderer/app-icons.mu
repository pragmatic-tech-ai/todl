// app-icons.mu — the shared icon dictionary for the TODL app.
//
// Each `include` splices an SVG (under ./icons, relative to this file) into a
// keyed Geometry resource at compile time — the CLI's SVG→geometry resolver,
// wired into the app's vite build (electron.vite.config.ts). Merged into the
// app's Resources by app.mu's `merge AppIcons`, so a capability's `Icon = @<Key>`
// resolves against Application.Resources at render time and is painted by the
// rail's Shape with a theme brush (no colour baked into the geometry).

resources AppIcons {
    include "icons/home.svg"      as Home
    include "icons/packages.svg"  as Packages
    include "icons/compiler.svg"  as Compiler
    include "icons/solutions.svg" as Solutions
}
