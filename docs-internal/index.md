---
title: repo-docs internal notes
description: Second docs site — exercises the multi-site Nix module API against the same repo.
---

This page exists to dogfood `docsSite.sites.<name>` against a real second tree. The main `docs/` tree publishes as `packages.docs-site` with the **cortex-light** theme; this tree publishes as `packages.internal-site` with the **cortex-dark** theme.

Run them side-by-side:

```bash
nix run .#docs-preview      # cortex-light, served on :4322
nix run .#internal-preview  # cortex-dark, served on :4322 (set PORT to differ)
```

That same shape is what downstream monorepos use to publish, e.g., `packages.cortex-site` for research docs alongside `packages.docs-site` for the product manual.
