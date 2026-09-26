// presentation-bake.ts — the concrete presentation baker, ported from Plexus
// (mural-presentation-baker.ts + meta-model/presentation-publisher.ts +
// library/library-presentation-publisher.ts). Runs the MURAL compiler's include
// resolver over every icon a document declares (SVG → colored IconDefinition,
// raster → BitmapImage), producing a self-contained presentation.compiled.json
// (geometry inlined, imports stripped) plus an icon-index.json sidecar
// (entityKey → resource key). One unified `Publish` serves every producer
// project type — the meta-model vs library difference is ONLY `options.dictName`
// + `options.iconPrefix`, so there is no meta/library branching here.
//
// Icon discovery and resource-key assignment are NOT re-implemented here — they
// are owned by `PresentationResourceEmitter` (presentation-model.ts), which every
// method here calls with the emitter's real two-document contract: `document`
// (own-only — what gets ENUMERATED, so only this project's own icons are baked)
// and `closure` (a compiled package's `fullDocument` — used ONLY to resolve
// annotation ancestry, e.g. the literal `icon` annotation, which extends
// `MuralResource` in the prelude, outside any project's own nodes). Collapsing
// both to one document is wrong in either direction: `document` alone can't
// resolve prelude/base-inherited ancestry, and `closure` alone enumerates every
// base's icons too and makes AssignResourceKeys's stem-collision suffixing
// depend on which unrelated bases happen to be present.

import {
    compile, DEFAULT_SYMBOLS, svgToGeometryJs,
    type IncludeResolver, type IncludeResolution,
} from '@pragmatic-tech-ai/mural/compiler'

import { type IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { type TodlDocument } from '../../../compiler-services/emit/json.js'
import { type BakeOptions, type BakeResult } from './presentation-baker.js'
import { PresentationResourceEmitter } from './presentation-model.js'

// The pre-read icon content for a doc: SVGs as text (→ colored IconDefinition) and
// raster images as base64 data URIs (→ BitmapImage). `missing` names every
// referenced icon with no readable project file.
export interface ReadIconsResult { svgByPath: Map<string, string>; rasterUriByPath: Map<string, string>; missing: string[] }

// The self-contained, evaluable presentation payload written into the backend.
// `body` is the compiled resources class (geometry inlined, imports stripped);
// `symbols` are the names the loader destructures from its ctx; `className` is
// the resources block to instantiate.
export interface CompiledPresentation { body: string; symbols: string[]; className: string }

export class PresentationBake
{
    private static readonly PresentationDir = 'presentation'
    private static readonly CompiledFile = 'presentation.compiled.json'
    public static readonly IconIndexFile = 'icon-index.json'
    private static readonly BasicModule = '@pragmatic-tech-ai/mural/basic'
    private static readonly VisualEngineModule = '@pragmatic-tech-ai/mural/visual-engine'
    private static readonly ImportLinePattern = /^import\b.*\bfrom\b/
    private static readonly Base64ChunkSize = 0x8000
    private static readonly NoResourcesBlockMessage = 'presentation compile produced no resources block'
    private static readonly RasterMimeByExtension: Readonly<Record<string, string>> = {
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
    }
    private static readonly DefaultMime = 'application/octet-stream'

    // Raster icon extension → MIME type for the baked data URI.
    private static MimeOf(path: string): string
    {
        const dot = path.lastIndexOf('.')
        return (dot >= 0 ? PresentationBake.RasterMimeByExtension[path.slice(dot).toLowerCase()] : undefined)
            ?? PresentationBake.DefaultMime
    }

    // Base64-encode bytes without Buffer (renderer + node both have btoa). Chunked so a
    // large image never overflows the argument list of String.fromCharCode.
    private static BytesToBase64(bytes: Uint8Array): string
    {
        let bin = ''
        for (let i = 0; i < bytes.length; i += PresentationBake.Base64ChunkSize)
            bin += String.fromCharCode(...bytes.subarray(i, i + PresentationBake.Base64ChunkSize))
        return btoa(bin)
    }

    // Pre-reads every distinct icon `document` declares (annotation ancestry
    // resolved against `closure`): SVGs as text, raster images as base64 data
    // URIs. `missing` names every referenced icon with no readable project file.
    // Shared by every producer type so meta-model and library bake raster
    // identically.
    public static async ReadIcons(project: IStorage, document: TodlDocument, closure: TodlDocument): Promise<ReadIconsResult>
    {
        const svgByPath = new Map<string, string>()
        const rasterUriByPath = new Map<string, string>()
        const missing: string[] = []
        for (const path of PresentationResourceEmitter.DistinctIcons(document, closure))
        {
            if (PresentationResourceEmitter.IsRasterIcon(path))
            {
                try
                {
                    rasterUriByPath.set(path, `data:${PresentationBake.MimeOf(path)};base64,${PresentationBake.BytesToBase64(await project.ReadBytes(path))}`)
                }
                catch
                {
                    missing.push(path)
                }
            }
            else
            {
                try
                {
                    svgByPath.set(path, await project.ReadText(path))
                }
                catch
                {
                    missing.push(path)
                }
            }
        }
        return { svgByPath, rasterUriByPath, missing }
    }

    // Compiler include resolver over pre-read icon content, honoring the `colored` flag
    // the markup carries. An SVG under `include colored` bakes to `parseSvgIcon(text)` —
    // a COLORED IconDefinition that KEEPS the currentColor sentinel, so a monochrome
    // (currentColor / gradient / unspecified-fill) icon themes to the Icon's Foreground
    // instead of a baked black, while an explicit-color icon paints its own colors. A
    // plain `include` bakes monochrome geometry (svgToGeometryJs). A raster bakes to a
    // BitmapImage over an inline data URI. The default template draws an IconDefinition
    // through its Icon and a BitmapImage through its Image — no external file dependency.
    //
    // NB: parseSvgIcon runs at load, not bake time. The framework's svgToIconJs bakes the
    // geometry inline but serializes currentColor to opaque black — wrong for currentColor
    // icon sets (Fabric etc.), so it is intentionally NOT used here.
    public static IconIncludeResolver(svgByPath: Map<string, string>, rasterUriByPath: Map<string, string>): IncludeResolver
    {
        return (path, ctx): IncludeResolution => {
            if (PresentationResourceEmitter.IsRasterIcon(path))
            {
                const uri = rasterUriByPath.get(path)
                if (uri === undefined) throw new Error(`presentation raster include not pre-read: ${path}`)
                return {
                    entries: [{ key: ctx.key ?? path, valueJs: `new BitmapImage(${JSON.stringify(uri)})` }],
                    imports: [{ module: PresentationBake.VisualEngineModule, names: ['BitmapImage'] }],
                }
            }
            const text = svgByPath.get(path)
            if (text === undefined) throw new Error(`presentation include not pre-read: ${path}`)
            if (ctx.colored)
            {
                return {
                    entries: [{ key: ctx.key ?? path, valueJs: `parseSvgIcon(${JSON.stringify(text)})` }],
                    imports: [{ module: PresentationBake.BasicModule, names: ['parseSvgIcon'] }],
                }
            }
            const { valueJs, names } = svgToGeometryJs(text)
            return { entries: [{ key: ctx.key ?? path, valueJs }], imports: [{ module: PresentationBake.VisualEngineModule, names }] }
        }
    }

    // One self-contained assets `resources` block: an icon include per distinct OWN
    // icon (enumerated from `document`; ancestry resolved against `closure`), keyed
    // by its PresentationResourceEmitter-assigned resource key. Publish always bakes
    // colored — the compiled runtime artifact keeps each icon's own colors; the
    // Generate command's monochrome mode is for the inspection .mu only.
    public static CombinedSource(document: TodlDocument, closure: TodlDocument, dictName: string): string
    {
        const keys = PresentationResourceEmitter.AssignResourceKeys(document, closure)
        const includes = [...keys].map(([path, key]) => PresentationResourceEmitter.IncludeLine(path, key, true))
        return [`resources ${dictName} {`, ...includes, '}'].join('\n')
    }

    // Compile `document`'s presentation once and write it into `dest` under
    // `<base>/presentation/presentation.compiled.json`, plus an icon-index.json sidecar
    // (entityKey → resource key, keyed under `options.iconPrefix`). `document` is the
    // own-only doc — only ITS icons are baked, never a base's. `closure` (a compiled
    // package's `fullDocument`) is used ONLY to resolve annotation ancestry, so the
    // literal `icon` annotation (which extends `MuralResource` in the prelude) still
    // resolves. The artifact is ASSETS ONLY: one baked icon asset per distinct icon
    // (SVG → colored IconDefinition, raster → BitmapImage). No DataTemplates — every
    // entity renders through the host's one default template, which draws the icon
    // the icon-index names. Icon content is embedded, so the artifact has no external
    // file dependency. A referenced icon with no readable project file blocks the
    // publish (nothing is written).
    public static async Publish(
        project: IStorage, dest: IStorage, base: string, document: TodlDocument, closure: TodlDocument, options: BakeOptions,
    ): Promise<BakeResult>
    {
        const { svgByPath, rasterUriByPath, missing } = await PresentationBake.ReadIcons(project, document, closure)
        if (missing.length > 0) return { ok: false, missing }

        const source = PresentationBake.CombinedSource(document, closure, options.dictName)
        const include = PresentationBake.IconIncludeResolver(svgByPath, rasterUriByPath)
        const result = compile(source, { include, symbols: new Map(DEFAULT_SYMBOLS) })

        const names = new Set<string>()
        for (const set of result.imports.values()) for (const n of set) names.add(n)
        const className = result.resourcesBlocks?.[0]?.name
        if (className === undefined) throw new Error(PresentationBake.NoResourcesBlockMessage)

        const body = result.js.split('\n').filter((line) => !PresentationBake.ImportLinePattern.test(line)).join('\n').trim()
        const artifact: CompiledPresentation = { body, symbols: [...names].sort(), className }
        await dest.WriteText(`${base}/${PresentationBake.PresentationDir}/${PresentationBake.CompiledFile}`, JSON.stringify(artifact))

        await dest.WriteText(
            `${base}/${PresentationBake.PresentationDir}/${PresentationBake.IconIndexFile}`,
            JSON.stringify(Object.fromEntries(PresentationResourceEmitter.BuildIconIndex(document, closure, options.iconPrefix))),
        )

        return { ok: true, icons: svgByPath.size + rasterUriByPath.size }
    }
}
