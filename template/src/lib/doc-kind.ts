import type {CollectionEntry} from "astro:content";

type DocsEntry = CollectionEntry<"docs">;

/*
 * Derive a stable "kind" identifier for a doc, used to opt into
 * doc-type-specific theming via the `docs-prose-<kind>` class on
 * the rendered article element.
 *
 * Resolution order:
 *   1. Explicit `kind:` field in frontmatter (always wins).
 *   2. Path-based heuristic: take the doc's first path segment and
 *      singularise the common cortex IA buckets so `adrs/...` →
 *      `adr`, `research-notes/...` → `research-note`, etc.
 *   3. Fall back to the first path segment verbatim, or `default`
 *      for the docs-root index.
 *
 * Themes can target the resulting class freely; nothing breaks if
 * a kind has no matching CSS rules — it just renders with the base
 * prose styling.
 */
const PATH_KIND_OVERRIDES: Record<string, string> = {
  adrs: "adr",
  "research-notes": "research-note",
  publications: "publication",
  handoffs: "handoff",
  experiments: "experiment",
  references: "reference",
  reference: "reference",
  consumers: "consumer",
  architectures: "architecture",
  architecture: "architecture",
};

export function deriveDocKind(entry: DocsEntry): string {
  const explicit = (entry.data as {kind?: unknown}).kind;
  if (typeof explicit === "string" && explicit.trim() !== "") {
    return explicit
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "-");
  }
  const id = entry.id.replace(/\\/g, "/");
  const firstSegment = id.split("/")[0] ?? "";
  if (!firstSegment || firstSegment.endsWith(".md") || firstSegment.endsWith(".mdx")) {
    return "default";
  }
  return PATH_KIND_OVERRIDES[firstSegment] ?? firstSegment;
}
