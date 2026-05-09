/*
 * URL / slug helpers shared across the docs template.
 *
 * Kept separate from site-config.ts so getStaticPaths() bodies (which
 * Astro extracts into their own module) can pull these without
 * dragging the full site-config import graph in. The tags page in
 * particular needs `tagSlug` inside its `getStaticPaths`.
 */

/**
 * Lower-case a free-form tag and collapse non-alphanumeric runs into
 * single dashes. Used everywhere a tag becomes a URL segment.
 */
export function tagSlug(tag: string): string {
  return tag
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
