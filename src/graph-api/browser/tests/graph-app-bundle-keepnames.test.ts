import { test } from "node:test";
import assert from "node:assert/strict";
import { MuralAppBundle } from "../../generated/graph-app-bundle.js";

// Regression guard for the black-screen theme bug: mural's theme/scheme lookup and
// property store are keyed by class `.name` (ThemeManager registers schemes by name;
// Material.Activate resolves the scheme by the passed class's `.name`). If the browser
// bundle is built without esbuild `keepNames`, esbuild renames classes (MaterialDark ->
// _MaterialDark) and theme activation throws at runtime ("theme 'Material' has no scheme
// '_MaterialDark'") — a black page that no Node/unit test catches because those import
// unminified source. esbuild emits `__name(...)` calls ONLY when keepNames is active, so
// its presence in the committed bundle proves class names survive bundling.
test("the committed browser bundle preserves class names (esbuild keepNames)", () =>
{
    assert.ok(
        MuralAppBundle.includes("__name("),
        "graph-app-bundle.ts must be built with esbuild keepNames so mural's name-keyed "
        + "theme/scheme lookup works in the browser; regenerate via `npm run gen:graph-app`.",
    );
});
