---
title: Getting Started
description: How to consume the flake module in another repository
sidebar:
  order: 1
---

# Getting Started

This guide wires repo-docs into a `flake-parts` repository and builds the first
static site. The consumer repository only owns Markdown content and Nix
configuration; repo-docs supplies the Astro template and build pipeline.

## 1. Add the Flake Input

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
            excludePaths = [ "private" ];

            site = {
              title = "My Project";
              tagline = "Documentation";
              description = "Project documentation";
              publicBaseUrl = "https://docs.example.com";
            };

            navigation.sectionLabels = {
              guides = "Guides";
            };
          };
        };
      };
    };
}
```

## 2. Create a Docs Tree

```text
docs/
  index.md
  guides/
    getting-started.md
```

Each Markdown page needs a `title`:

```markdown
---
title: My Project
description: Project overview
---

# My Project

Welcome to the docs.
```

## 3. Build and Run

- `nix build .#docs-site` -- build the static site
- `nix run .#docs-dev` -- start the dev server
- `nix run .#docs-preview` -- preview a production build

The site name controls output names. `sites.docs` produces `docs-site`,
`docs-dev`, and `docs-preview`. A site named `manual` produces `manual-site`,
`manual-dev`, and `manual-preview`.

## 4. Pick a Theme

```nix
sites.docs = {
  contentDir = ./docs;
  theme = "cortex-light";
};
```

Built-in themes are `cortex-dark`, `cortex-light`, and `cortex-slate`. To expose
a reader-controlled light/dark switcher:

```nix
themeModes = {
  light = "cortex-light";
  dark = "cortex-slate";
};
```

## Navigation

If you do not set `navigation.sections` explicitly, the module derives sidebar sections from the docs tree automatically:

- Root-level pages go under "Overview"
- Each top-level directory becomes its own section
- Nested directories become collapsible groups

Use `navigation.sectionLabels` to set human-readable labels for directory sections, or `navigation.sections` for full control over ordering and grouping.

For the in-between case — auto-generated sections, but a fixed display order — use `navigation.topLevelOrder`:

```nix
navigation.topLevelOrder = [ "guides" "reference" "examples" ];
```

This is strict: every name must match an actual top-level folder, and every actual top-level folder must appear in the list. Misspellings, missing folders, and unlisted folders all fail the build with an explicit error message.

## Multiple Sites

A monorepo can publish several independent sites:

```nix
docsSite.sites = {
  public = {
    contentDir = ./docs/public;
    site.title = "Public Docs";
    site.publicBaseUrl = "https://example.com/docs";
    site.routeBase = "/docs";
  };

  internal = {
    contentDir = ./docs/internal;
    theme = "cortex-dark";
    site.title = "Internal Notes";
    site.publicBaseUrl = "https://example.com/internal";
    site.routeBase = "/internal";
  };
};
```

This creates `packages.public-site`, `packages.internal-site`, and matching apps
and checks.

## Generated Integrations

Add integrations only when a site needs them:

```nix
sites.docs = {
  contentDir = ./docs;
  lean4.theoryDir = "theory";
  haskell.packages.core.packageDir = "haskell/core";
  typst.manuscripts.paper1.dir = "Publications/Paper-1/typst";
  languages.wire.grammarSrc = inputs.tree-sitter-wire;
};
```

- `lean4.theoryDir` publishes a generated Lean Theory section.
- `haskell.packages` builds Cabal packages and publishes generated Haddock API pages.
- `typst.manuscripts` compiles explicit Typst manuscript folders to PDF reader pages.
- `languages` registers tree-sitter grammars for custom fenced-code blocks.

## Template Overrides

The `templateFiles` option lets you replace any file in the shared Astro template. Common overrides:

| File | Purpose |
|------|---------|
| `src/styles/global.css` | Colors, fonts, spacing |
| `tailwind.config.mjs` | Tailwind theme tokens |
| `src/layouts/DocsLayout.astro` | Page layout |

## Content Schema

Every markdown file needs a `title` in its frontmatter:

```yaml
---
title: Page Title
description: Optional description
sidebar:
  order: 1        # optional sort order
  label: Custom   # optional sidebar label override
  hidden: false   # optional, hide from sidebar
draft: false       # optional, exclude from build
---
```

Next steps:

- [Feature Reference](feature-reference.md) for the complete rendering surface.
- [Configuration Guide](configuration.md) for more Nix examples.
- [Rendering Example](rendering-example.md) to see the built-in Markdown features.
