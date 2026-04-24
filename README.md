# repo-docs

Reusable docs site module for `flake-parts` repositories.

## What it provides

- `flakeModules.default` for consumer repos
- a shared Astro/Tailwind template that renders one or more plain markdown trees
- multi-site support (publish several independent docs sites from one monorepo)
- automatic `.md` / `.mdx` link rewriting (write portable links that work in editors, on GitHub, and on the rendered site)
- date-prefixed-filename auto-sort (`2026-04-15-foo.md` files sort newest-first)
- frontmatter `status:` rendered as a coloured pill in the nav
- Mermaid diagram rendering with fullscreen support
- LaTeX math rendering via KaTeX
- Syntax-highlighted code blocks for all common languages (Shiki)
- Tree-sitter–driven highlighting for custom languages, compiled from grammar source at build time
- Per-site Nix outputs: `packages.<name>-site`, `apps.<name>-{dev,preview}`, `checks.<name>-site`

The consumer repo keeps one or more markdown trees. Each tree is declared as a *site* under `docsSite.sites.<name>`; the module configures the shared Astro template, routing, navigation, theme, and any custom-language grammars from Nix. The consumer repo does not need its own Astro config, layout, Tailwind config, or docs `package.json`.

This repository dogfoods both single- and multi-site shapes: `docsSite.sites.docs` builds `packages.docs-site` (cortex-light) from `./docs`, and `docsSite.sites.internal` builds `packages.internal-site` (cortex-dark) from `./docs-internal`.

## Consumer shape

```text
docs/
  index.md
  guides/
    getting-started.md
    rendering-example.md
```

The only required input is `docsSite.sites.<name>.contentDir`. Everything else has defaults.

By default, navigation is auto-generated from each site's docs tree:

- root-level pages go under `Overview` (set `rootSectionLabel = null` to drop that eyebrow)
- each top-level directory becomes its own sidebar section
- nested directories are rendered as collapsible tree groups; the active page's ancestors auto-expand

For more control, override site metadata, exclusions, section labels, explicit sections, theme, or shared template files per-site.

## Consuming the module — single site

```nix
{
  inputs.repo-docs.url = "github:Digimuoto/repo-docs";

  outputs = inputs @ { flake-parts, repo-docs, ... }:
    flake-parts.lib.mkFlake { inherit inputs; } {
      imports = [ repo-docs.flakeModules.default ];

      systems = [ "x86_64-linux" ];

      perSystem = { ... }: {
        docsSite = {
          enable = true;

          sites.docs = {
            contentDir = ./docs;
            theme = "cortex-light";
            excludePaths = [ "private" "drafts" ];

            site = {
              title = "Project Docs";
              tagline = "Documentation";
              description = "Internal docs";
              publicBaseUrl = "https://docs.example.com";
              routeBase = "/docs";
              footerText = "© 2026 Your Team";
            };

            navigation.sectionLabels = {
              guides = "Guides";
            };

            templateFiles = {
              "src/styles/global.css" = ./docs-theme/global.css;
            };
          };
        };
      };
    };
}
```

This produces `packages.docs-site`, `apps.docs-dev`, `apps.docs-preview`, and `checks.docs-site`. Naming the site anything other than `docs` simply changes those output prefixes.

## Consuming the module — multiple sites in one monorepo

A monorepo can publish several independent docs trees side-by-side. Each entry under `docsSite.sites` becomes its own self-contained site with its own theme, route base, navigation, and language registry:

```nix
docsSite = {
  enable = true;

  sites.docs = {                          # → packages.docs-site, apps.docs-{dev,preview}
    contentDir = ./docs/portman;
    theme = "cortex-dark";
    site = {
      title = "Portman";
      publicBaseUrl = "https://portman.example.com";
      routeBase = "/";
    };
  };

  sites.cortex = {                        # → packages.cortex-site, apps.cortex-{dev,preview}
    contentDir = ./docs/cortex;
    theme = "cortex-light";
    site = {
      title = "Cortex Research";
      tagline = "Engineering & specifications";
      publicBaseUrl = "https://cortex.example.com";
      routeBase = "/cortex";
    };
    navigation.rootSectionLabel = null;   # no "Overview" eyebrow on the research wiki
    languages.wire = {
      grammarSrc = inputs.tree-sitter-wire;
    };
  };
};
```

Then:

```bash
nix run .#docs-preview      # Portman site (cortex-dark)
nix run .#cortex-preview    # Cortex research site (cortex-light)
```

**Per-site knobs** (each entry under `docsSite.sites.<name>` accepts):

- `contentDir` *(required)*
- `excludePaths`
- `theme` — `"cortex-dark"` (default) or `"cortex-light"`
- `site.*` — `title`, `tagline`, `description`, `publicBaseUrl`, `routeBase`, `footerText`
- `repo.*` — `repoUrl`, `editBaseUrl`
- `navigation.sections` — explicit nav (overrides auto-generation)
- `navigation.rootSectionLabel` — set `null` to drop the auto-generated "Overview" eyebrow
- `navigation.sectionLabels` — directory-to-label map for auto-generated sections
- `templateFiles` — per-site overrides for any file in the shared template
- `languages` — per-site tree-sitter grammar registry (see below)

**Deep / complex trees** (the cortex-style layout in the example: `publications/paper-*/figures/*.mmd`, `adrs/*.md`, multi-level nested groups) work without extra configuration:

- The staging script only picks up `.md` and `.mdx`. Sidecar files (`.mmd`, images, generated artefacts) live alongside but never become pages.
- The collapsible tree nav handles arbitrary nesting; ancestor groups of the active page auto-expand and the rest defer to the user's saved collapse state.
- For directories that should sort by something other than alphabetical, set `sidebar.order` in each leaf's frontmatter, or add the directory's own `index.md` with `sidebar.order` to push the whole branch up or down.

## Authoring conventions

These features are on by default; nothing to configure.

### Portable `.md` links

Author markdown links that point at `.md` / `.mdx` files using paths relative to the source file. They're rewritten to clean published URLs at build time, with `#fragment` and `?query` preserved.

```markdown
See [Wire grammar](../reference/wire/grammar-v1.md).
See [the runtime](./06-pulse-runtime.md#executors).
```

Both forms work in your editor, on GitHub web, *and* on the rendered site. External (`https://…`), absolute (`/foo`), and bare-anchor (`#bar`) links pass through untouched.

### Date-prefixed filenames sort newest-first

Files matching `^YYYY-MM-DD-…\.md$` automatically sort chronologically (newest at the top of the section) without per-file `sidebar.order`. Mix dated and undated files freely — undated entries (typically `index.md` or `overview.md`) lead the section, then dated entries follow newest-first.

```text
research-notes/wire/
  index.md                                       ← lands first
  2026-04-23-wire-composition-sugar.md           ← then newest dated entry
  2026-04-16-wire-dataflow.md
  2026-04-15-wire-syntax.md
```

ADRs (`0001-…`, `0002-…`) and chaptered material (`01-…`, `02-…`) keep their existing ascending-numeric sort because they don't match the ISO date prefix.

### Lifecycle status badges

Add `status: <value>` to a page's frontmatter and the nav renders a small pill next to the entry. Well-known values get distinct theme colours; anything else falls through to a neutral pill.

```yaml
---
title: ADR 0014 — Executor taxonomy
status: accepted        # well-known → green
---
```

```yaml
---
title: Wire composition sugar
status: research        # cortex-specific → neutral pill
---
```

Built-in palette (each theme overrides the colours):

| Status         | Colour family             |
| -------------- | ------------------------- |
| `draft`        | warning / amber           |
| `proposed`     | warning / amber           |
| `accepted`     | success / green           |
| `active`       | accent / brand blue       |
| `superseded`   | muted grey + dimmed label |
| `deprecated`   | danger / red              |
| `archived`     | very muted, dimmed label  |
| *(other)*      | neutral default pill      |

`superseded` and `archived` also dim the label itself so the eye lands on still-current docs first.

## Custom-language syntax highlighting

Register tree-sitter grammars for fenced code blocks whose language isn't in Shiki's bundled set. Each entry compiles its `grammarSrc` to WebAssembly via the tree-sitter CLI (using emscripten from nixpkgs) and ships the result alongside its `queries/highlights.scm`.

```nix
# flake.nix
{
  inputs.tree-sitter-wire = {
    url = "github:portman-lang/tree-sitter-wire";
    flake = false;
  };
}
```

```nix
# per-system docsSite config
docsSite.sites.<your-site>.languages.wire = {
  grammarSrc = inputs.tree-sitter-wire;
  # Optional:
  #   aliases = [ "wr" ];
  #   highlightQueries = ./overrides/wire/queries;
};
```

Any `` ```wire `` (or an alias) fenced block is tokenised by the grammar at build time; tokens get CSS classes derived from the capture names (`tok-keyword`, `tok-function`, `tok-string.special`, …). The token palette lives in the theme CSS files and is swapped automatically with `docsSite.theme`.

Unregistered languages continue to flow through Shiki's github-light / github-dark dual-theme path.

**Notes.**

- The grammar source must either ship a pre-generated `src/parser.c` or a `grammar.js` the tree-sitter CLI can generate from. Both upstream patterns work without extra configuration.
- The quality of highlighting depends entirely on the grammar's `queries/highlights.scm`. This module is pure plumbing — it can only paint captures the grammar emits.
- If a grammar fails to load at runtime (malformed queries, incompatible ABI, etc.), the block falls back to Shiki's plain-text rendering and a warning is logged; the docs build continues.

Then use (replace `docs` with whatever site name(s) you declared):

- `nix build .#docs-site`
- `nix run .#docs-dev`
- `nix run .#docs-preview`

## Local verification

- `nix flake check --builders ''`
- `nix build --builders '' .#docs-site`
- `nix run .#docs-dev`
