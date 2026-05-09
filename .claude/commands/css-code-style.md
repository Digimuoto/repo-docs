---
name: css-code-style
description: >
  CSS / styling / theming code review for the repo-docs template
  (template/src/styles/). Use whenever reviewing, writing, or
  refactoring CSS, theme palettes, or style hooks. Triggers
  include: "review the styles", "add a theme", "fix this CSS",
  cascade questions, palette work, Mermaid theme variables, or any
  diff under template/src/styles/ or stage-docs-site.mjs's
  haddock-iframe palette block.
---

# CSS / Styling Code Style Review

Review CSS in `template/src/styles/` plus the theme-aware code in
`stage-docs-site.mjs` and `MermaidEnhancer.astro` against the
project's conventions: theme-driven custom properties, BEM-style
naming under `docs-` and `repo-docs-` namespaces, `color-mix()`
for derived shades, and the cross-file checklist for adding a new
theme.

## Usage

```
/css-code-style [target...]
```

**Arguments:**

- No arguments — diffs current branch vs `main`, reviews changed
  CSS / theme / Mermaid / haddock-palette files.
- File paths — review specific files.
- Directory paths — review every `.css` / theme-touching file under
  the directory.

## Workflow

### 1. Determine scope

```bash
git diff --name-only main...HEAD -- \
  'template/src/styles/**/*.css' \
  'template/src/components/MermaidEnhancer.astro' \
  'scripts/stage-docs-site.mjs'
```

Plus any files explicitly named on the command line.

### 2. Automated pre-checks

```bash
FILES=...

# Hard-coded hex colours outside the theme files
grep -rnE '#[0-9a-fA-F]{3,6}\b' \
  template/src/styles/global.css \
  template/src/components \
  | grep -v 'styles/themes/\|styles/palette\|MermaidEnhancer\|stage-docs-site'

# Hand-mixed alpha (rgba) where color-mix would be cleaner
grep -rn 'rgba(' template/src/styles/global.css \
  | grep -v '\(--border\|--card\|surface-with-alpha\)'

# Tailwind utility classes leaking into chrome (we are
# hand-rolled — Tailwind is on prose only)
grep -rnE 'class=".*\b(text|bg|border|p|m|flex)-[a-z0-9-]+' \
  template/src/components

# Theme name that doesn't appear in every theme-aware file
for theme in cortex-dark cortex-dark-darker cortex-light cortex-slate; do
  echo "== $theme =="
  for f in \
    template/src/styles/themes/$theme.css \
    template/src/lib/site-config.ts \
    nix/flake-module.nix \
    scripts/stage-docs-site.mjs \
    template/src/components/MermaidEnhancer.astro \
    flake.nix; do
    grep -l "$theme" "$f" >/dev/null || echo "  MISSING in $f"
  done
done
```

### 3. Read reference material

- `template/src/styles/themes/*.css` — one `:root { ... }` block per
  theme, each defining the same set of `--*` custom properties. The
  staging pipeline reads these by regex; the structure is fixed.
- `template/src/styles/palette.css` — fallback used in template-mode
  development; gets overwritten by `stage-docs-site.mjs` per
  consumer. Keep in sync with `cortex-dark` (the SSR baseline).
- `template/src/styles/global.css` — the single rule sheet. Long,
  but organised top-down: reset → typography → page chrome →
  prose → kind-specific overrides → integrations.
- `scripts/stage-docs-site.mjs` line 716+ — `html[data-theme="..."]`
  blocks for the haddock iframe. One block per theme; each carries
  `--rd-*` variables that the iframe's repo-docs-haddock.css reads.
- `template/src/components/MermaidEnhancer.astro` — theme-keyed
  Mermaid `themeVariables` for slate-family themes. The default and
  dark Mermaid stock themes cover the others.

### 4. Review each file

Apply the rubric. Per-file checks:

- **Custom properties from the theme**, never hex literals, in
  `global.css` and component-scoped rules. Theme files themselves
  are exempt — they're the leaves.
- **`color-mix(in srgb, var(--*) <pct>%, transparent)`** is the
  preferred way to derive a tinted/translucent variant. Hand-rolled
  `rgba()` is reserved for the borders ramp (which encodes
  luminance bias on purpose).
- **Naming**: `.docs-*` for first-party page chrome, `.repo-docs-*`
  for cross-cutting wrappers (Lean page, haddock embed, proof state
  panel). BEM-style: `block-element` (no underscores), descendants
  via composition not deeply-nested selectors.
- **No Tailwind in `template/src/components/` or styles/**. The
  prose container has Tailwind-typography hooks (the `.prose`
  class), but the chrome around it is hand-rolled. Utility classes
  in chrome components are a regression.
- **Theme-add checklist** — adding a theme is a single-file edit:

  1. `template/src/styles/themes/<name>.css` — the palette body.

  The staging pipeline picks up the new file automatically:

  - `nix/flake-module.nix` reads
    `template/src/styles/themes/*.css` at evaluation time so the
    `theme` and `themeModes.{light,dark}` enums extend without
    code changes.
  - `scripts/stage-docs-site.mjs`'s `loadThemePalettes` parses
    every theme CSS into a registry, drives the dynamic
    `html[data-theme="<name>"]` block in the haddock-iframe
    palette, and codegens
    `template/src/generated/themes.ts` so the `SiteTheme`
    TypeScript union and runtime registry stay synced.

  Two manual touches remain, both optional:

  - `template/src/components/MermaidEnhancer.astro` — only when
    the theme needs custom Mermaid `themeVariables` (the slate
    family has its own cycling-tints palette; the github-dark
    and github-light defaults cover the rest).
  - `docs/guides/mermaid-diagrams.md` — when the new theme
    introduces a different Mermaid behaviour worth documenting
    in the per-theme table.

  Flag any rename / addition diff that **edits the deprecated
  hardcoded enums** (`BUILTIN_THEMES` Set, `SiteTheme` union
  literal, `nix/flake-module.nix` enum string list) — they're
  meant to be derived now, not authored.

### 5. Report

- **[P1]** Theme rename / add that misses a checklist file (will
  break SSR or runtime theme-switching).
- **[P2]** Hard-coded hex outside theme files, hand-rolled rgba
  where color-mix is cleaner, deep selector chains.
- **[style]** Naming drift, missing comments on non-obvious cascade
  decisions.

### 6. Offer fixes

## Core principles

### 1. Theme variables are the single source of colour truth

Every colour that varies by mode comes from the theme file. The
rule sheet reads `var(--*)`; the theme file holds the hex. Adding
a new colour means adding a new variable and setting it in _every_
theme — even if some themes share the value.

```css
/* BAD: hex floats in global.css; flips wrong on theme switch */
.docs-sidebar {
  background: #161b22;
}

/* GOOD: theme-driven */
.docs-sidebar {
  background: var(--surface-primary);
}
```

### 2. `color-mix` for derived tones, `rgba` only for the borders ramp

Soft fills, hover states, badge tints — all derive from a base
variable via `color-mix`:

```css
.docs-meta-pill {
  border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
  background: color-mix(in srgb, currentColor 8%, transparent);
}

.prose pre {
  background-color: var(--surface-primary);
  border: 1px solid var(--border-primary);
}
```

The borders ramp (`--border-primary` etc.) uses literal `rgba(240,
246, 252, 0.10)` etc. by design — the `rgba` carries luminance bias
that `color-mix` over `currentColor` would lose.

### 3. Naming carries the namespace

- `.docs-*` — first-party docs chrome (sidebar, TOC, title, mode
  toggle).
- `.repo-docs-*` — cross-cutting renderers (Lean page, haddock
  embed, proof state, mermaid card).
- `.prose` and `.prose-*` — Tailwind-typography hooks that scope
  reading-prose styling.

Mixing these (e.g. a `.docs-haddock-foo` for haddock chrome) is a
smell. The `repo-docs-` prefix specifically means "this lives
inside an iframe or imported HTML and must not collide with the
host stylesheet."

### 4. Theme-aware integrations have parallel structure

Three places re-encode the same set of variables for the same set
of themes:

- `template/src/styles/themes/<name>.css` (the host page palette).
- The `html[data-theme="<name>"]` blocks in
  `scripts/stage-docs-site.mjs` (the haddock iframe palette).
- `MermaidEnhancer.astro`'s `slateThemeVariables` (Mermaid SVG fills
  for the cortex-slate cycling-tints treatment; cortex-dark and
  cortex-dark-darker fall through to Mermaid's stock dark theme).

When adding a value to one, decide: does it need to flow to the
other two? Surface colours and brand colours — yes. Status pills —
only host palette. Token highlight colours — host palette only,
unless the haddock iframe uses them in the small token subset its
block exposes. Document the answer in the theme file's header
comment.

### 5. Cascade beats specificity

The rule sheet is organised top-down by concept. New chrome lands
near the existing chrome it composes with, not at the bottom of
the file. Avoid `!important` unless the project deliberately wants
to override a third-party stylesheet (notably KaTeX and Mermaid's
own CSS). Each `!important` should carry a comment explaining what
it overrides.

### 6. The single global.css is the canon (for now)

The repo currently ships one `global.css` orchestrator that
expects a single source-order cascade. Astro's component-scoped
CSS would mean every consumer fetches a different bundle per
page, which defeats the shared-cache model. Keep the file
ordered, well-commented, and sectioned with header banners. If a
section grows past ~300 lines, flag it as a candidate for
`@layer` decomposition. **Note**: a per-concern split into
`_chrome.css`, `_prose.css`, `integrations/_*.css` etc. is
planned but blocked on a working `@layer` story that doesn't
break the Tailwind cascade. Until that lands, treat extracting
new concerns into separate files as out of scope; new rules go
into the appropriate banner-delimited section in `global.css`.

### 7. Stylelint enforces the high-value rules

`nix run .#_check-format` runs stylelint as part of the treefmt
sweep on every commit + in CI. The rules that matter for the
architecture intent:

- `color-no-hex` — every literal hex outside theme files is a
  bug. Tailwind escape hatches like the `white` keyword are
  fine. Mermaid SVG node-fill overrides are the one documented
  exception: wrap them in `/* stylelint-disable color-no-hex */`
  ... `/* stylelint-enable color-no-hex */` with a comment that
  says why theme variables can't reach the SVG.
- `function-disallowed-list` — `rgb()`, `hsl()`, and `hwb()`
  are forbidden. Use `var(--*)`, `color-mix()`, or `rgba()` (for
  the borders ramp) instead.
- `max-nesting-depth: 3` — selectors nested deeper than three
  levels are usually a refactor signal. Hoist or compose via
  classes.
- `at-rule-no-unknown` whitelists Tailwind directives
  (`@tailwind`, `@apply`, `@layer`, `@screen`, `@variants`,
  `@responsive`, `@config`); new at-rules need an entry in
  `.stylelintrc.json`.

`selector-class-pattern` is **disabled** at the lint level. The
codebase consumes classes from Verso, Tailwind, KaTeX, Mermaid,
and Haddock that don't fit a single namespace regex; encoding
them all turned into a brittle list. The namespace conventions
above (`docs-`, `repo-docs-`, `prose-`, etc.) still apply for
authored selectors — enforce them in review, not via the linter.
