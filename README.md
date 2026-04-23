# repo-docs

Reusable docs site module for `flake-parts` repositories.

## What it provides

- `flakeModules.default` for consumer repos
- a shared Astro/Tailwind template that renders a plain `docs/` tree
- Mermaid diagram rendering with fullscreen support
- LaTeX math rendering via KaTeX
- Syntax-highlighted code blocks for all common languages (Shiki)
- Tree-sitter–driven highlighting for custom languages, compiled from grammar source at build time
- Nix outputs for:
  - `packages.docs-site`
  - `apps.docs-dev`
  - `apps.docs-preview`
  - `checks.docs-site`

The consumer repo keeps a markdown `docs/` tree. Site metadata, routing, exclusions, navigation overrides, and template overrides are configured in the Nix module. The consumer repo does not need its own Astro config, layout, Tailwind config, or docs `package.json`.

This repository dogfoods the module through its own `docs/` tree, so `nix build .#docs-site` builds the real repo docs instead of a separate fixture site.

## Consumer shape

```text
docs/
  index.md
  guides/
    getting-started.md
    rendering-example.md
```

The only required input is `docsSite.contentDir = ./docs;`. Everything else has defaults.

By default, navigation is auto-generated from the docs tree:

- root-level pages go under `Overview`
- each top-level directory becomes its own sidebar section

If you want more control, you can override site metadata, exclusions, section labels, explicit sections, or shared template files from Nix.

## Consuming the module

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
          contentDir = ./docs;
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
}
```

Available module knobs:

- `docsSite.contentDir`
- `docsSite.excludePaths`
- `docsSite.theme` — `"cortex-dark"` (default) or `"cortex-light"`
- `docsSite.site.*`
- `docsSite.repo.*`
- `docsSite.navigation.sections`
- `docsSite.navigation.rootSectionLabel` (set `null` to drop the auto-generated "Overview" eyebrow)
- `docsSite.navigation.sectionLabels`
- `docsSite.templateFiles`
- `docsSite.languages` — see below

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
docsSite.languages.wire = {
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

Then use:

- `nix build .#docs-site`
- `nix run .#docs-dev`
- `nix run .#docs-preview`

## Local verification

- `nix flake check --builders ''`
- `nix build --builders '' .#docs-site`
- `nix run .#docs-dev`
