---
title: Rendering Example
description: A kitchen-sink page demonstrating all supported rendering features
sidebar:
  order: 2
---

# Rendering Example

This page exercises every rendering feature to verify that the template produces correct output.

## Inline Formatting

Regular text with **bold**, *italic*, ***bold italic***, `inline code`, and [a link](#inline-formatting).

## Headings

### Third Level

#### Fourth Level

##### Fifth Level

## Lists

Unordered:

- First item
- Second item with `inline code`
- Third item
  - Nested item
  - Another nested item
- Fourth item

Ordered:

1. First step
2. Second step
3. Third step
   1. Sub-step
   2. Another sub-step

## Blockquote

> This is a blockquote. It can contain **bold**, *italic*, and `code`.
>
> It can span multiple paragraphs.

## Horizontal Rule

---

## Code Blocks

Nix expression:

```nix
{
  description = "Example flake";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { nixpkgs, ... }:
    let
      pkgs = nixpkgs.legacyPackages.x86_64-linux;
    in {
      packages.default = pkgs.hello;
    };
}
```

TypeScript:

```typescript
interface Config {
  title: string;
  baseUrl: string;
  sections: Section[];
}

function buildNavigation(config: Config): Sidebar {
  return config.sections.map((section) => ({
    label: section.label,
    items: section.entries.map(resolveEntry),
  }));
}
```

Shell session:

```bash
nix build .#docs-site
nix run .#docs-dev -- --port 8080
```

## Tables

| Feature | Status | Notes |
|---------|--------|-------|
| Mermaid diagrams | Supported | Fullscreen toggle included |
| LaTeX math | Supported | Via KaTeX |
| Syntax highlighting | Supported | All common languages |
| MDX | Supported | Via `@astrojs/mdx` |
| Dark mode | Default | Customizable via CSS variables |

## Mermaid Diagrams

Flowchart:

```mermaid
flowchart LR
  Content["docs/ tree"] --> Module["repo-docs module"]
  Module --> Build["nix build .#docs-site"]
  Module --> Dev["nix run .#docs-dev"]
  Module --> Preview["nix run .#docs-preview"]
```

Sequence diagram:

```mermaid
sequenceDiagram
  participant Consumer as Consumer Flake
  participant Module as repo-docs Module
  participant Staging as Staging Script
  participant Astro as Astro Build

  Consumer->>Module: contentDir, site config
  Module->>Staging: stage content + config
  Staging->>Astro: merged template + content
  Astro-->>Consumer: static HTML site
```

State diagram:

```mermaid
stateDiagram-v2
  [*] --> Staging
  Staging --> Building: content staged
  Building --> Output: build complete
  Output --> [*]

  state Staging {
    [*] --> CopyContent
    CopyContent --> ApplyExclusions
    ApplyExclusions --> GenerateNav
    GenerateNav --> WriteConfig
  }
```

## LaTeX Math

Inline math: The quadratic formula is $x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}$.

Display math:

$$
\int_{-\infty}^{\infty} e^{-x^2} dx = \sqrt{\pi}
$$

A matrix:

$$
A = \begin{bmatrix}
a_{11} & a_{12} & \cdots & a_{1n} \\
a_{21} & a_{22} & \cdots & a_{2n} \\
\vdots & \vdots & \ddots & \vdots \\
a_{m1} & a_{m2} & \cdots & a_{mn}
\end{bmatrix}
$$

Euler's identity: $e^{i\pi} + 1 = 0$

A summation:

$$
\sum_{k=1}^{n} k = \frac{n(n+1)}{2}
$$

## Images

Images use standard markdown syntax and are constrained to content width:

![Placeholder](https://placehold.co/800x200/1f2937/f5f5f5?text=Image+Placeholder)

## Nested Content

A list containing code and emphasis:

1. Run the build:
   ```bash
   nix build .#docs-site
   ```
2. Check the output contains **all expected pages**
3. Verify the site config has `title` set to `"repo-docs"`
