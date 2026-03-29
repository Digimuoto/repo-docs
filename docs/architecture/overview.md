---
title: Architecture Overview
description: How repo-docs turns markdown into a site
sidebar:
  order: 1
---

# Architecture Overview

The module has three layers:

1. A Nix helper that stages consumer content and builds the site.
2. A flake module that exposes `docs-site`, `docs-dev`, and `docs-preview`.
3. A shared Astro template that renders markdown with the standard docs layout.

By default, the module publishes the whole markdown tree under `contentDir`, except paths excluded via `docsSite.excludePaths`.

Navigation is auto-generated from the filesystem unless `docsSite.navigation.sections` is set explicitly.
