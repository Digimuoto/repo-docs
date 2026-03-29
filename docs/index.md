---
title: repo-docs
description: Overview of the reusable docs module
---

# repo-docs

This repository packages a reusable docs site for `flake-parts` repositories.

The consumer repo keeps:

- a `docs/` tree of markdown files

The Nix module configures the site metadata, routing, navigation behavior, exclusions, and template overrides.

The consumer repo does not keep its own Astro boilerplate, layout, Tailwind config, docs `package.json`, or repo-local docs config file.

## Start Here

- [Getting Started](guides/getting-started/)
- [Architecture Overview](architecture/overview/)
- [Tree Navigation](architecture/advanced/tree-navigation/)

## Consumer Outputs

Once imported, the module exposes:

- `packages.docs-site`
- `apps.docs-dev`
- `apps.docs-preview`
- `checks.docs-site`

## Genericity

Everything is configurable from the Nix module:

- docs tree location
- route base
- site metadata
- excluded paths
- auto-generated or explicit navigation
- template file overrides
