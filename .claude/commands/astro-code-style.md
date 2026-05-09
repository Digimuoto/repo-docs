---
name: astro-code-style
description: >
  Astro 6 + TypeScript code style review for the repo-docs template
  (template/src/). Use whenever reviewing, writing, or refactoring
  .astro components, layouts, page routes, content collections, or
  the lib/ helpers. Triggers include: "review this component",
  "refactor this layout", component design questions, content
  collection schema, or any work in template/src/.
---

# Astro Code Style Review

Review Astro / TypeScript code in `template/src/` against the project's
conventions: Astro 6 frontmatter discipline, content collections,
`siteConfig` + `withBasePath`, inline-script handling for pre-paint
work, and the staged-template build pipeline.

## Usage

```
/astro-code-style [target...]
```

**Arguments:**

- No arguments — diffs current branch vs `main`, reviews changed
  `.astro` / `.ts` / `.mjs` files under `template/src/`.
- File paths — review specific files.
- Directory paths — review every `.astro` / `.ts` under the directory.

## Workflow

### 1. Determine scope

```bash
# Branch diff mode
git diff --name-only main...HEAD -- \
  'template/src/**/*.astro' \
  'template/src/**/*.ts' \
  'template/src/**/*.mjs'

# Directory mode
find "$DIR" \
  \( -name '*.astro' -o -name '*.ts' -o -name '*.mjs' \) \
  -not -path '*/node_modules/*'
```

### 2. Automated pre-checks

Run these grep checks first — they catch the high-value issues with
zero ambiguity:

```bash
FILES=...  # the targets

# `any` types in production code
grep -rn ': any\b' $FILES | grep -v '\.d\.ts'

# Hand-rolled URL building instead of withBasePath()
grep -rn 'siteConfig\.site\.routeBase' $FILES \
  | grep -v 'site-config.ts'
grep -rn '`/${.*routeBase' $FILES

# Raw absolute hrefs that should go through withBasePath()
grep -rnE 'href="/(repo-docs|internal)' $FILES

# Hard-coded brand or theme colours instead of var(--*)
grep -rnE '#[0-9a-fA-F]{3,6}' $FILES \
  | grep -v 'styles/themes/\|styles/palette\|MermaidEnhancer\|stage-docs-site'

# <script> blocks without is:inline that try to read server data
grep -rn '<script>' $FILES | grep -v 'is:inline'
```

Report any hits as findings (severity per the rubric below).

### 3. Read reference material

Before reviewing, hold these conventions in head:

- `template/src/lib/site-config.ts` — `SiteTheme` union, `SiteConfig`
  interface, `siteConfig`, `withBasePath`, `kebabToTitle`. Anything
  the components consume goes through these helpers.
- `template/src/lib/navigation.ts` — `SidebarSection`,
  `buildSidebar`, `findReadingSequence`. Components import the
  types from here, not from raw config.
- `template/src/content.config.ts` — content-collection schemas. The
  `docs` collection is the single source of doc frontmatter truth;
  Components destructure `doc.data.*` from this typed shape.
- `template/src/layouts/DocsLayout.astro` — the canonical layout.
  All page routes route through it; new chrome belongs here, not in
  individual page files.

### 4. Review each file

Apply the rubric. Per-file checks:

- **Props interface declared explicitly** at the top of the
  frontmatter, not inferred from `Astro.props`. Optional props use
  `?`, never `| undefined`.
- **Types from `astro:content` for content entries**, not
  hand-written. `CollectionEntry<"docs">` is the right shape for
  docs.
- **Inline scripts use `is:inline`** when they:
  - Need server-rendered values via `define:vars={{...}}`
  - Run before Vite hydration (pre-paint theme init, sidebar
    width restore, etc.)
- **Embed sections with inline scripts live in dedicated
  components**, not inside `{cond && (<section>…<script>…)}`
  expressions in another file. The pattern that broke
  prettier-plugin-astro 0.14.x —
  `{typstPdfHref ? <section …<script>…</script></section> : …}` —
  is also a composition smell: the embed has its own data
  contract (one prop per content kind) and its own DOM event
  handlers, so it deserves its own component file. New embed
  follows the same shape as `TypstEmbed.astro` and
  `HaddockEmbed.astro`: dedicated component takes a single href/
  data prop, parent renders it as
  `{href && <NewEmbed href={href} title={title} />}`.
- **Path construction goes through `withBasePath()`** — no manual
  string interpolation against `siteConfig.site.routeBase`. Same
  rule for `kebabToTitle()` instead of inline regex on segments.
- **Component placement**:
  - `template/src/layouts/` — page layouts (one per kind).
  - `template/src/components/` — reusable chrome blocks.
  - `template/src/pages/` — route entries only; logic delegated to
    components/lib.
- **No `any` in production .ts files**. `unknown` + narrowing or
  type predicates instead. Generated code (`*.d.ts`) is exempt.
- **Astro frontmatter discipline**: imports first, type/interface
  declarations next, `const props = Astro.props` and derived values
  at the bottom. No business logic between sections.

### 5. Report

Same shape as `frontend-style.md`:

- **[P1]** Correctness, type-safety holes, broken cross-theme
  behaviour.
- **[P2]** Architecture / maintainability — duplication of
  `siteConfig` parsing, layout sprawl.
- **[style]** Naming, formatting, comment hygiene.

### 6. Offer fixes

If the user wants the findings fixed, apply changes consistent with
the conventions below.

## Core principles

### 1. The Props interface is the API

Every `.astro` file with props declares an `interface Props`
explicitly. The destructuring at the bottom of the frontmatter is
the only place defaults appear.

```astro
---
import type { MarkdownHeading } from "astro";

interface Props {
  description?: string;
  headings?: MarkdownHeading[];
  title: string;
}

const {
  description = siteConfig.site.description,
  headings = [],
  title,
} = Astro.props;
---
```

Components without explicit Props are an architectural smell — they
are usually ones that should have been a slot or a layout.

### 2. Content types come from the collection, not from imagination

Doc shape is owned by `template/src/content.config.ts`. Anything
that consumes a doc takes a `CollectionEntry<"docs">` and reads
`doc.data.*` directly.

```ts
// BAD: hand-written and will drift from the schema
interface Doc {
  title: string;
  description?: string;
  // ...
}

// GOOD: derived from astro:content
import type { CollectionEntry } from "astro:content";
type Doc = CollectionEntry<"docs">;
```

### 3. `siteConfig` is the only knob

Everything theme-, route-, or repo-related funnels through
`siteConfig` from `lib/site-config.ts`. Components don't import the
raw `site-config.json`; the `lib` module is the type-checked
boundary.

```astro
---
// BAD: re-deriving the route base inline
import rawConfig from "../generated/site-config.json";
const base = rawConfig.site.routeBase ?? "/";

// GOOD: typed helpers
import { siteConfig, withBasePath } from "../lib/site-config";
const indexHref = withBasePath();
const tagHref = withBasePath(`tags/${tagSlug}`);
---
```

### 4. Inline scripts use `is:inline` + `define:vars`

Any `<script>` that needs a server-rendered value (palette names,
bundle path, mode-toggle wiring) is `is:inline` and receives the
data via `define:vars={{...}}`. Vite-bundled `<script>` blocks run
post-hydration and are wrong for pre-paint work.

```astro
<script is:inline define:vars={{ pagefindBundlePath }}>
  // Pre-paint: pull the bundle path the SSR pass computed.
  // Vite would not see this script's body as a module.
  console.log(pagefindBundlePath);
</script>
```

If the script doesn't need server data and runs after hydration, a
plain `<script>` is fine — Astro will bundle it via Vite. Don't mix
the two.

### 5. The DocsLayout owns page chrome

New navigation, sidebar, footer, mode-toggle, or search behaviour
lives in `DocsLayout.astro` (or a component the layout composes),
never in a page route. Page routes are thin: collect data, hand to
the layout, render content via `<slot />`.

### 6. Path helpers, not string interpolation

Use `withBasePath()` for hrefs, `kebabToTitle()` for display labels,
`siteConfig.site.title` for chrome text. Manual `${routeBase}/foo`
constructions miss the trailing-slash and root-base cases that
`withBasePath` already handles.

### 7. Avoid `any`

If TypeScript can't narrow a value at a boundary, take `unknown` and
write a predicate. The single legitimate `any` cast in this repo is
the `(window as any).__repoDocsState` global — a documented escape
hatch for cross-component browser state. No others.

```ts
// BAD
function isTheme(value: any): boolean {
  return ["cortex-dark", ...].includes(value);
}

// GOOD
function isTheme(value: unknown): value is SiteTheme {
  return typeof value === "string"
    && (THEMES as ReadonlyArray<string>).includes(value);
}
```

### 8. Build pipeline awareness

`template/` is staged into `/tmp/docs-site-dev-*` by
`scripts/stage-docs-site.mjs`. Two consequences worth keeping in
mind:

- New theme/feature additions almost always touch
  `stage-docs-site.mjs` _and_ `template/src/styles/themes/*` _and_
  `template/src/lib/site-config.ts` _and_ `nix/flake-module.nix`.
  The CSS-code-style skill enforces that checklist; this skill
  flags the TS / Astro side (`SiteTheme` union, parser branch).
- The dev server (`nix run .#docs-dev`) does not hot-reload from
  `template/` — it reloads from the staged copy. Reviewers should
  call out tests that assume HMR-against-source.
