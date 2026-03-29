---
title: repo-docs
description: Overview of the reusable docs module
---

# repo-docs

A reusable docs site module for `flake-parts` repositories.

The consumer repo keeps a `docs/` tree of markdown files. The Nix module handles site metadata, routing, navigation, exclusions, and template overrides. No Astro boilerplate needed in the consumer repo.

## Start Here

- [Getting Started](guides/getting-started/)
- [Rendering Example](guides/rendering-example/)

## Consumer Outputs

Once imported, the module exposes:

- `packages.docs-site`
- `apps.docs-dev`
- `apps.docs-preview`
- `checks.docs-site`

## Features

- Auto-generated or explicit sidebar navigation
- Mermaid diagram rendering with fullscreen support
- LaTeX math via KaTeX
- Syntax-highlighted code blocks
- Dark theme with customizable CSS variables
- Template file overrides from Nix
