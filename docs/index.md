---
title: repo-docs
description: Overview of the reusable docs module
---

# repo-docs

repo-docs is a reusable documentation site module for `flake-parts`
repositories. A consumer repository keeps ordinary Markdown files under a docs
tree; repo-docs stages that tree into a shared Astro template, builds static
HTML, and exposes Nix apps/checks/packages for development and publishing.

The goal is pragmatic: keep source docs pleasant to read in editors and GitHub,
then render them as a navigable site with search, diagrams, math, code
highlighting, publication workflows, Lean theory pages, and optional Typst PDF
manuscripts.

## Start Here

- [Getting Started](guides/getting-started.md) — import the flake module and build your first site.
- [Feature Reference](guides/feature-reference.md) — what repo-docs renders and how it behaves.
- [Configuration Guide](guides/configuration.md) — site options, navigation, themes, integrations, and examples.
- [Rendering Example](guides/rendering-example.md) — a kitchen-sink page for Markdown, code, math, Mermaid, and footnotes.
- [Mermaid Diagrams](guides/mermaid-diagrams.md) — author diagrams that survive themes and fullscreen mode.
- [Typst Manuscripts](guides/typst-manuscripts.md) — compile paper folders to PDF reader pages.
- [Development Guide](guides/development.md) — work on repo-docs itself.
- [Lean 4 Theory Demo](Theory/) — generated pages from the fixture Lean package.

## What You Get

Each site declared under `docsSite.sites.<name>` exposes:

- `packages.<name>-site` — static HTML output.
- `apps.<name>-dev` — Astro dev server over a staged template tree.
- `apps.<name>-preview` — production build plus preview server.
- `checks.<name>-site` — a Nix check that builds the site.

The conventional site name `docs` gives the short outputs `packages.docs-site`,
`apps.docs-dev`, and `apps.docs-preview`.

## Feature Surface

- Markdown and MDX pages with portable `.md` link rewriting.
- Auto-generated or explicit sidebar navigation with collapsible trees.
- Status pills, tag pages, document kind styling, and reading-sequence footers.
- Site-wide static search with Pagefind.
- Mermaid diagrams with fullscreen support and theme-aware rendering.
- KaTeX math, GFM footnotes, tables, blockquotes, and syntax-highlighted code.
- Tree-sitter grammar registration for custom fenced-code languages.
- Generated Lean 4 Theory section backed by Verso hovers and proof-state UI.
- Explicit Typst manuscript folders compiled to PDF reader routes.
- Multi-site monorepo support with independent route bases and themes.
- Template overrides for teams that need custom components or palettes.

## Repository Map

- `docs/` — public dogfood documentation.
- `docs-internal/` — second dogfood site for multi-site coverage.
- `template/` — shared Astro template copied into every staged site.
- `scripts/stage-docs-site.mjs` — staging, navigation, generated integrations.
- `nix/flake-module.nix` — public Nix module options.
- `nix/lib.nix` — build machinery for Astro, Lean/Verso, Typst, and grammars.
- `fixtures/` — small fixture docs trees for regression checks.

## Common Commands

```bash
nix build .#docs-site
nix run .#docs-dev
nix run .#docs-preview
nix build .#checks.x86_64-linux.docs-html
```

Use the [Development Guide](guides/development/) for the full local workflow and
the checks expected before changing shared rendering behavior.
