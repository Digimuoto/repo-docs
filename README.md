# repo-docs

Reusable docs site module for `flake-parts` repositories.

## What it provides

- `flakeModules.default` for consumer repos
- a shared Astro/Tailwind template that renders a plain `docs/` tree
- Mermaid diagram rendering with fullscreen support
- LaTeX math rendering via KaTeX
- Syntax-highlighted code blocks for all common languages
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
- `docsSite.site.*`
- `docsSite.repo.*`
- `docsSite.navigation.sections`
- `docsSite.navigation.rootSectionLabel`
- `docsSite.navigation.sectionLabels`
- `docsSite.templateFiles`

Then use:

- `nix build .#docs-site`
- `nix run .#docs-dev`
- `nix run .#docs-preview`

## Local verification

- `nix flake check --builders ''`
- `nix build --builders '' .#docs-site`
- `nix run .#docs-dev`
