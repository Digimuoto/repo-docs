---
title: Development Guide
description: How to work on repo-docs itself and verify shared rendering changes.
sidebar:
  order: 7
---

# Development Guide

This guide is for changing repo-docs itself: the Nix module, staging script,
Astro template, generated integrations, and dogfood docs.

## Repository Layout

```text
repo-docs/
  docs/                    # public dogfood site
  docs-internal/           # second site for multi-site coverage
  fixtures/                # small fixture repos used by checks
  nix/
    flake-module.nix       # public flake-parts module options
    lib.nix                # site build, Lean, Typst, grammar derivations
    grammar.nix            # tree-sitter grammar-to-wasm build helper
  scripts/
    stage-docs-site.mjs    # copies/stages content into the template
  template/
    src/                   # Astro app shared by all sites
```

The staging script is the seam between Nix and Astro. Nix builds any external
artifacts first (Lean/Verso HTML, Typst PDFs, tree-sitter grammars), then
`stage-docs-site.mjs` copies the docs tree into `template/src/content/docs`,
writes generated Markdown stubs, copies public assets, writes generated config,
and lets Astro build the final site.

## Day-to-Day Commands

```bash
nix build .#docs-site
nix run .#docs-dev
nix run .#docs-preview
```

The dev and preview apps stage into a temporary writable directory, install npm
dependencies there, and run Astro from the staged template. Consumer repos never
need to vendor the template or have their own `package.json`.

## Useful Checks

Run the smallest relevant check while iterating, then broaden before publishing.

| Change area | Useful command |
|-------------|----------------|
| Markdown/template rendering | `nix build .#checks.x86_64-linux.docs-html` |
| Multi-site behavior | `nix build .#checks.x86_64-linux.docs-multi-site` |
| Lean Theory rendering | `nix build .#checks.x86_64-linux.docs-lean4-theory` |
| Typst manuscripts | `nix build .#checks.x86_64-linux.docs-typst-manuscripts` |
| Staging script syntax | `node --check scripts/stage-docs-site.mjs` |
| Whitespace sanity | `git diff --check` |

For larger changes, run:

```bash
node --check scripts/stage-docs-site.mjs
nix build .#docs-site
nix build .#checks.x86_64-linux.docs-html
nix build .#checks.x86_64-linux.docs-multi-site
nix build .#checks.x86_64-linux.docs-lean4-theory
nix build .#checks.x86_64-linux.docs-typst-manuscripts
git diff --check
```

## Staging Pipeline

The high-level build flow is:

1. Copy `template/` to a writable staging tree.
2. Copy the configured `contentDir` into `src/content/docs`.
3. Remove reserved config files and excluded paths.
4. Generate integration content:
   - Lean Theory pages and Verso fragments.
   - Typst manuscript PDF assets and reader stubs.
   - tree-sitter grammar manifest.
5. Derive or validate navigation sections.
6. Remove Markdown pages that are outside navigation.
7. Write generated `site-config.json`, `grammars.json`, route files, and build env.
8. Run Astro and Pagefind.

This means generated Markdown pages participate in the same Astro content
collection as authored pages, but generated public assets live under `public/`.

## Adding a New Site Option

Most user-facing configuration starts in `nix/flake-module.nix`:

1. Add the option under `siteOptions`.
2. Thread the value into the `config` attrset passed to `mkDocsSite`.
3. If the option requires a Nix build artifact, add the derivation in
   `nix/lib.nix` and pass its output path to the staging script.
4. Parse and validate that path in `scripts/stage-docs-site.mjs`.
5. Add a fixture and a check in `flake.nix`.
6. Document the option under `docs/guides/` and update the README if it is a
   major feature.

Prefer explicit configuration over autodetection for integrations that can have
local layouts, build inputs, or sidecar files. Lean and Typst both follow that
rule.

## Changing the Astro Template

Template changes live under `template/src`. Keep these constraints in mind:

- `DocsPage.astro` is the central page renderer for content collection entries.
- `DocsLayout.astro` owns the sidebar, search, TOC, theme bootstrapping, and
  global scripts.
- `content.config.ts` is the frontmatter contract for authored and generated
  Markdown.
- `global.css` is shared across every consumer site unless overridden.

When adding generated-page behavior, prefer a narrow frontmatter field and a
small component over special-casing routes. Generated pages should still build
through the content collection unless there is a strong reason not to.

## Lean Theory Notes

Lean rendering is intentionally Verso-first:

- `/-! ... -/` module docs are module prose.
- `/-- ... -/` declaration docstrings stay attached to declarations by Lean and
  rendered by Verso.
- ordinary `/- ... -/` comments remain code comments.

Do not reinterpret Lean comments in the staging script. Styling may improve the
readability of Verso's output, but semantics should stay with Lean/Verso.

## Typst Manuscript Notes

Typst manuscripts are explicit projects. The build reads
`repo-docs-typst.json`, compiles the named entry with `pkgs.typst`, and stages a
generated reader page plus the compiled PDF. Do not autodetect `*.typ` files;
manuscript directories often contain layout files, alternate drafts, packages,
and assets that are not entry points.

## Tree-Sitter Notes

Tree-sitter grammars are compiled to WebAssembly in Nix and consumed at Markdown
build time. The template does not know language semantics; it only receives
captures from `queries/highlights.scm` and maps them to token classes.

When debugging custom highlighting:

- confirm the grammar builds to WASM
- confirm the fenced language tag matches the grammar name or an alias
- inspect emitted `tok-*` spans in the generated HTML
- verify the theme has a readable color for the capture class

## Documentation Standards

Documentation in this repo should satisfy three audiences:

- consumers who only want to import the module
- authors writing Markdown, Lean, Typst, diagrams, and papers
- maintainers changing the shared implementation

When adding a feature, update at least one consumer-facing guide and one
regression fixture. If the feature changes public Nix configuration, update the
README and Configuration Guide too.
