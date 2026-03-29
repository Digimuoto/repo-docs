---
title: Getting Started
description: How to consume the flake module in another repository
sidebar:
  order: 1
---

# Getting Started

Import the module from a consumer flake:

```nix
{
  inputs.repo-docs.url = "github:your-org/repo-docs";

  outputs = inputs @ { flake-parts, repo-docs, ... }:
    flake-parts.lib.mkFlake { inherit inputs; } {
      imports = [ repo-docs.flakeModules.default ];

      systems = [ "x86_64-linux" ];

      perSystem = { ... }: {
        docsSite = {
          enable = true;
          contentDir = ./docs;
          excludePaths = [ "private" ];

          site = {
            title = "My Project";
            publicBaseUrl = "https://docs.example.com";
          };

          navigation.sectionLabels = {
            api = "API Reference";
          };

          templateFiles = {
            "src/styles/global.css" = ./docs-theme/global.css;
          };
        };
      };
    };
}
```

Then use:

- `nix build .#docs-site` -- build the static site
- `nix run .#docs-dev` -- start the dev server
- `nix run .#docs-preview` -- preview a production build

## Navigation

If you do not set `navigation.sections` explicitly, the module derives sidebar sections from the docs tree automatically:

- Root-level pages go under "Overview"
- Each top-level directory becomes its own section

Use `navigation.sectionLabels` to set human-readable labels for directory sections, or `navigation.sections` for full control over ordering and grouping.

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
