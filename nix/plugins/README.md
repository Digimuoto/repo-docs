# Stack plugins

A "stack plugin" packages a documentation source other than plain
markdown — Haskell Haddock, Lean Verso, Typst manuscripts, and (in
principle) anything else with a build-time renderer. Each plugin
ships three pieces:

| Layer | File                                                                                    | Responsibility                                                                                                                                                           |
| ----- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Nix   | `nix/plugins/<name>.nix`                                                                | Take per-site config + the content tree, produce a derivation containing a `manifest.json` plus the rendered assets.                                                     |
| Node  | `scripts/plugins/<name>.mjs`                                                            | Read the manifest in `outDir`, copy assets into `public/`, generate markdown stubs with plugin-specific frontmatter under `src/content/docs/`, return nav contributions. |
| Astro | `template/src/components/<Name>Embed.astro` (or fragment injection in `DocsPage.astro`) | Read the plugin frontmatter, render the appropriate embed (iframe, inline fragment, etc.).                                                                               |

The three layers communicate by file:

```
nix builder ──manifest.json──> scripts/plugins/<name>.mjs ──frontmatter──> Astro renderer
              + assets                                       + assets in public/
```

## Nix layer (`nix/plugins/<name>.nix`)

Exports one function:

```nix
{ pkgs, lib, ... }: {
  # Build derivation. `name` namespaces the output; `contentDir` is
  # the consumer's docs/ root; `pluginConfig` is the parsed
  # docsSite.<plugin>.* attrset.
  mkBuild = { name, contentDir, pluginConfig }: pkgs.stdenv.mkDerivation {
    # Output layout is plugin-specific but conventionally:
    #   $out/manifest.json   — JSON describing what was built.
    #   $out/<assets>/       — files the staging step copies into public/.
  };
}
```

`nix/lib.nix` imports the plugin and threads its `mkBuild` through
the per-site builder pipeline. The flake-module exposes the
plugin's option schema via `docsSite.<plugin-name>` so consumers
configure it like any other field.

## Node layer (`scripts/plugins/<name>.mjs`)

Exports one async function:

```js
export async function stage(ctx) {
  // ctx = {
  //   contentRoot,    // <outDir>/src/content/docs
  //   publicRoot,     // <outDir>/public
  //   generatedRoot,  // <outDir>/src/generated
  //   outDir,         // staged template root
  //   config,         // full siteConfig (the consumer's nix attrset)
  //   pluginConfig,   // parsed docsSite.<plugin>.* attrset
  //   renderedDir,    // path to the Nix-built output (manifest + assets)
  //   themePalettes,  // Map<themeName, Map<varName, value>> for plugins
  //                   // that emit theme-aware iframe CSS
  // };
  //
  // Side-effects: copy assets, write markdown stubs.
  //
  // Returns: { label, entries } | null
  //   label   : section label for the auto-generated nav (or null
  //             if entries are inline at the doc root).
  //   entries : ordered list of doc IDs to surface in the nav.
}
```

`scripts/stage-docs-site.mjs` imports each enabled plugin's `stage`
function and calls it after the markdown content is in place. The
returned `{ label, entries }` is merged into the auto-generated
sidebar.

## Astro layer (`template/src/components/<Name>Embed.astro`)

Astro components are imported by `DocsPage.astro` and rendered when
the doc's frontmatter carries the plugin's marker key (e.g.
`typst.pdf`, `haddock.html`, `verso.fragment`). The plugin owns:

- The marker frontmatter shape — declared in
  `template/src/content.config.ts`.
- The render component — typically an iframe with theme-sync, or an
  inline `<Fragment set:html=…>`.
- Optional: a heading extractor for the TOC (Lean does this from the
  Verso fragment; Haddock does it from the iframe DOM at runtime).

## Status

| Plugin    | Nix layer                    | Node layer                         | Astro layer                              |
| --------- | ---------------------------- | ---------------------------------- | ---------------------------------------- |
| `typst`   | ✅ `nix/plugins/typst.nix`   | ⏳ inline in `stage-docs-site.mjs` | ✅ `TypstEmbed.astro`                    |
| `haskell` | ✅ `nix/plugins/haskell.nix` | ⏳ inline in `stage-docs-site.mjs` | ✅ `HaddockEmbed.astro`                  |
| `lean4`   | ✅ `nix/plugins/lean4.nix`   | ⏳ inline in `stage-docs-site.mjs` | ✅ inline in `DocsPage.astro` (fragment) |

All three Nix builders are extracted; thin wrappers in `nix/lib.nix`
keep the call-site signatures stable. The Lean plugin takes `verso`
as an import-time argument so the heavyweight Verso toolchain
derivation is still built once at the top of `nix/lib.nix` and
shared across sites. The Node staging layer for all three remains
inline in `scripts/stage-docs-site.mjs` pending a follow-up sweep —
that's the next ⏳ in the table, and the natural extraction is the
`generate{Typst,Haskell,Lean4}Docs` functions into
`scripts/plugins/<name>.mjs`.
