import type { MarkdownHeading } from "astro";

/*
 * Heading-window helpers shared by the desktop TOC and the mobile
 * TOC disclosure. Both surfaces want the same depth filter (h2..h4
 * by default) and the same "normalise the depth so the shallowest
 * visible heading sits at indent 0" rule.
 */

export interface VisibleHeadingsOptions {
  minDepth?: number;
  maxDepth?: number;
}

/** Drop headings outside the requested depth window. */
export function filterHeadings(
  headings: MarkdownHeading[],
  { minDepth = 2, maxDepth = 4 }: VisibleHeadingsOptions = {},
): MarkdownHeading[] {
  return headings.filter(
    (heading) => heading.depth >= minDepth && heading.depth <= maxDepth,
  );
}

/**
 * Compute the indent depth offset for a filtered heading list. The
 * shallowest heading present sits at indent 0; deeper ones step in
 * relative to it. Falls back to `maxDepth` when the list is empty so
 * callers can spread the result without a special-case branch.
 */
export function minVisibleDepth(
  visible: MarkdownHeading[],
  { maxDepth = 4 }: VisibleHeadingsOptions = {},
): number {
  return visible.reduce(
    (lowest, heading) => Math.min(lowest, heading.depth),
    maxDepth,
  );
}
