---
title: Configuration Guide
description: Practical Nix examples for configuring repo-docs sites.
sidebar:
  order: 3
---

# Configuration Guide

repo-docs is configured from `perSystem.docsSite`. The module expects at least
one named site under `docsSite.sites`.

## Minimal Site

```nix
docsSite = {
  enable = true;

  sites.docs = {
    contentDir = ./docs;
    site = {
      title = "Project Docs";
      publicBaseUrl = "https://docs.example.com";
    };
  };
};
```

Build and run:

```bash
nix build .#docs-site
nix run .#docs-dev
nix run .#docs-preview
```

`docs` is only a convention. A site named `manual` produces
`packages.manual-site`, `apps.manual-dev`, and `apps.manual-preview`.

## Site Metadata

```nix
sites.docs = {
  contentDir = ./docs;

  site = {
    title = "Cortex Research";
    tagline = "Architecture, proofs, papers";
    description = "Research and engineering documentation";
    publicBaseUrl = "https://example.com/cortex";
    routeBase = "/cortex";
    footerText = "© 2026 Cortex";
  };

  repo = {
    repoUrl = "https://github.com/example/cortex";
    editBaseUrl = "https://github.com/example/cortex/edit/main/docs";
  };
};
```

`publicBaseUrl` is used for canonical metadata and build-time environment. Use
`routeBase` when the site is served from a subpath.

## Excluding Private Material

```nix
sites.docs = {
  contentDir = ./docs;
  excludePaths = [ "private" "drafts/internal-plan.md" ];
};
```

Excluded paths are removed during staging before navigation is validated. A path
can name a file, directory, or extensionless markdown stem.

## Navigation Patterns

Auto-generated navigation is the default. Use labels and strict ordering when
you like the tree but want stable top-level presentation:

```nix
navigation = {
  rootSectionLabel = null;
  sectionLabels = {
    guides = "Guides";
    reference = "Reference";
    publications = "Publications";
  };
  topLevelOrder = [ "guides" "reference" "publications" ];
};
```

Use explicit sections when you want to curate the sidebar manually:

```nix
navigation.sections = [
  {
    label = null;
    entries = [ "/" "guides/getting-started" ];
  }
  {
    label = "Guides";
    dir = "guides";
  }
  {
    label = "External";
    links = [
      { label = "GitHub"; href = "https://github.com/example/project"; }
    ];
  }
];
```

Exactly one of `entries`, `dir`, or `links` must be set for each section.

## Theme Configuration

Pick one theme:

```nix
theme = "cortex-light";
```

Or expose a mode toggle:

```nix
themeModes = {
  light = "cortex-light";
  dark = "cortex-slate";
};
```

Theme variables live under `template/src/styles/themes/`. Use `templateFiles`
if a consumer needs to replace the palette or larger template pieces.

## Template Overrides

```nix
templateFiles = {
  "src/styles/palette.css" = ./docs-theme/palette.css;
  "src/components/DocsTitle.astro" = ./docs-theme/DocsTitle.astro;
};
```

Paths are relative to the shared template root. Overrides run after the template
is copied and before generated route files are written, so route overrides can
replace `src/pages/[...slug].astro` too.

## Custom Languages

```nix
inputs.tree-sitter-wire = {
  url = "github:example/tree-sitter-wire";
  flake = false;
};

docsSite.sites.docs.languages.wire = {
  grammarSrc = inputs.tree-sitter-wire;
  aliases = [ "wr" ];
};
```

The grammar must include `src/parser.c` or a `grammar.js` that tree-sitter can
generate. Highlight quality depends on `queries/highlights.scm`; repo-docs only
plumbs the captures into CSS token classes.

## Lean 4 Theory Pages

```nix
docsSite.sites.docs = {
  contentDir = ./docs;
  lean4.theoryDir = "theory";
};
```

`theoryDir` is resolved from the parent of `contentDir`, so with
`contentDir = ./docs`, the example points at `./theory`.

The directory must be a Lake package. repo-docs builds the modules with Verso,
copies the interactive assets, and appends a generated `Theory` section unless
your explicit navigation already includes it.

## Haskell Haddock Pages

```nix
docsSite.sites.docs.haskell.packages.core = {
  packageDir = "haskell/core";
  packageName = "my-core";
  title = "Core API";
};
```

`packageDir` is resolved from the parent of `contentDir`, so with
`contentDir = ./docs`, the example points at `./haskell/core`.

The directory must be a Cabal package. repo-docs builds it with
`pkgs.haskellPackages.callCabal2nix`, copies the Haddock HTML output, and
appends a generated `Haskell` section unless your explicit navigation already
includes it.

## Typst Manuscripts

```nix
docsSite.sites.docs.typst.manuscripts.paper1.dir =
  "Publications/Paper-1/typst";
```

The folder must include `repo-docs-typst.json`:

```json
{
  "entry": "manuscript.typ",
  "output": "manuscript.pdf",
  "route": "Publications/Paper-1/manuscript",
  "title": "Paper 1",
  "sidebar": { "label": "Manuscript", "order": 2 }
}
```

repo-docs compiles the Typst entry with `pkgs.typst`, publishes the PDF, and
generates the reader route. The build fails if that route would overwrite an
authored Markdown page.

## Multi-Site Example

```nix
docsSite = {
  enable = true;

  sites.public = {
    contentDir = ./docs/public;
    theme = "cortex-light";
    site = {
      title = "Public Docs";
      publicBaseUrl = "https://example.com/docs";
      routeBase = "/docs";
    };
  };

  sites.internal = {
    contentDir = ./docs/internal;
    theme = "cortex-dark";
    site = {
      title = "Internal Notes";
      publicBaseUrl = "https://example.com/internal";
      routeBase = "/internal";
    };
  };
};
```

This exposes independent packages, apps, and checks for each site.
