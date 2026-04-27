---
title: Feature Reference
description: A guided inventory of what repo-docs renders and generates.
sidebar:
  order: 2
---

# Feature Reference

repo-docs is intentionally small from the consumer side: point it at one or
more content trees and configure the site in Nix. The feature surface lives in
the shared template and staging pipeline.

## Content Model

Every published document is a Markdown or MDX file with frontmatter:

```yaml
---
title: Page Title
description: Optional subtitle and meta description
sidebar:
  label: Short label
  order: 10
  hidden: false
status: draft
tags:
  - reference
---
```

Required fields:

| Field | Purpose |
|-------|---------|
| `title` | Page heading, browser title, navigation fallback label |

Common optional fields:

| Field | Purpose |
|-------|---------|
| `description` | Page subtitle and meta description |
| `draft` | Exclude the page from collections and static paths when `true` |
| `status` | Sidebar status pill such as `draft`, `active`, `accepted` |
| `tags` | Clickable title badges and generated `/tags/<slug>/` pages |
| `kind` | Override the derived document kind CSS hook |
| `author`, `authors`, `date`, `updated` | Title byline metadata |
| `sidebar.label` | Shorter navigation label |
| `sidebar.order` | Manual ordering within a directory |
| `sidebar.hidden` | Build the page but omit it from the sidebar |

Generated integrations add private frontmatter fields such as `verso.fragment`
and `typst.pdf`. Authored pages should not set those directly.

## Navigation

When `navigation.sections` is omitted, repo-docs derives the sidebar from the
content tree:

- root-level pages go into a root section, labelled `Overview` by default
- each top-level directory becomes a sidebar section
- nested directories become collapsible groups
- active ancestors open automatically
- `index.md` is the landing page for a directory

Ordering rules:

- `sidebar.order` wins first
- ISO-date filename prefixes like `2026-04-15-note.md` sort newest-first
- undated pages sort before dated streams
- remaining entries sort by label

If you need fixed top-level ordering but still want auto-generated sections,
use `navigation.topLevelOrder`. It is strict by design: every top-level folder
must appear exactly once.

For complete control, use explicit sections:

```nix
navigation.sections = [
  {
    label = null;
    entries = [ "/" "guides/getting-started" ];
  }
  {
    label = "Reference";
    dir = "reference";
  }
];
```

## Source-Friendly Links

Write links to Markdown files as if you were reading the repository in an
editor or on GitHub:

```markdown
[Runtime chapter](../architecture/06-runtime.md)
[Mechanization plan](./lean-mechanization.md#remaining-work)
```

repo-docs rewrites `.md` and `.mdx` links to clean published URLs while
preserving fragments and query strings. External URLs, absolute paths, and bare
anchors pass through unchanged.

## Rendering Pipeline

The template supports the usual authoring primitives without per-site setup:

- GFM tables, task-list syntax, footnotes, and autolinks
- MDX through Astro's MDX integration
- Shiki highlighting for common fenced-code languages
- KaTeX for inline and display math
- Mermaid diagrams rendered client-side with fullscreen support
- responsive images, tables, code blocks, and wide diagrams

The [Rendering Example](rendering-example.md) page is the regression-oriented
showcase for these features.

## Search and Reading Flow

Production builds run Pagefind over the generated HTML. The sidebar search box
loads the static index from the deployed route base, so search works when a site
is hosted at `/`, `/docs`, or any other configured prefix.

Every page also gets a previous/next footer derived from the materialized
sidebar order. This works for chaptered material, ADR lists, dated research
notes, and explicit navigation sections.

## Theming

Built-in themes:

| Theme | Use case |
|-------|----------|
| `cortex-dark` | Default deep dark documentation site |
| `cortex-light` | Warm paper-like research wiki |
| `cortex-slate` | Lifted dark theme for sustained reading |

Set one static theme:

```nix
theme = "cortex-light";
```

Or expose a reader-controlled light/dark switcher:

```nix
themeModes = {
  light = "cortex-light";
  dark = "cortex-slate";
};
```

Consumers can replace template files through `templateFiles` if they need a
custom palette, layout component, or route implementation.

## Generated Integrations

### Lean Theory

`lean4.theoryDir` points at a Lake package. repo-docs builds its modules with
Verso and publishes a generated `Theory` section. Module doc comments
`/-! ... -/` render as prose; declarations remain interactive Lean fragments
with semantic hovers, declaration links, tactic proof states, and proof badges.

### Typst Manuscripts

`typst.manuscripts.<name>.dir` points at a manuscript folder under `contentDir`.
The folder must include `repo-docs-typst.json`; repo-docs compiles the entry
with `pkgs.typst`, publishes the PDF asset, and generates a reader route.

### Tree-Sitter Grammars

`languages.<name>.grammarSrc` compiles a tree-sitter grammar to WebAssembly and
uses its highlight queries for matching fenced-code blocks. This is useful for
custom languages where Shiki has no grammar.

## Multi-Site Repositories

Each `docsSite.sites.<name>` entry builds independently. A monorepo can publish
several docs sites with different themes, route bases, grammars, and generated
integrations from the same flake.

```nix
docsSite.sites = {
  docs = {
    contentDir = ./docs;
    site.title = "Project Docs";
  };

  internal = {
    contentDir = ./docs-internal;
    theme = "cortex-dark";
    site.routeBase = "/internal";
  };
};
```

This produces `packages.docs-site`, `packages.internal-site`, matching apps,
and matching checks.
