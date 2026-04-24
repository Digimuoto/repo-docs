/**
 * Rewrite relative `.md` / `.mdx` links to the docs site's published URLs.
 *
 * Authors write portable links that work in editors and on GitHub web:
 *
 *   See [Wire grammar](../reference/wire/grammar-v1.md).
 *   See [the runtime](./06-pulse-runtime.md#executors).
 *
 * The plugin resolves each href relative to the file being processed,
 * strips the markdown extension, collapses `…/index` to the directory
 * URL, prepends `routeBase`, and re-attaches any `#fragment` or
 * `?query` suffix verbatim. External links (http://, mailto:),
 * absolute paths (`/x`), and bare anchors (`#x`) pass through
 * untouched.
 *
 * The plugin needs to know:
 *   - where the docs collection lives on disk (`docsRoot`) so it can
 *     turn a resolved file path back into a slug
 *   - the site's `routeBase` so it can prefix the URL correctly
 * Both are passed in at registration time from astro.config.mjs.
 */

import path from "node:path";
import {visit} from "unist-util-visit";

function toCleanSlug(docsRoot, absolutePath) {
  const rel = path.relative(docsRoot, absolutePath).replace(/\\/g, "/");
  const withoutExt = rel.replace(/\.(md|mdx)$/i, "");
  if (withoutExt === "index") return "";
  return withoutExt.replace(/\/index$/i, "");
}

function buildHref(trimmedBase, slug, suffix) {
  const pathPart = slug === "" ? "/" : `/${slug}/`;
  return `${trimmedBase}${pathPart}${suffix}`;
}

export function markdownLinkRewriter({docsRoot, routeBase = "/"}) {
  if (!docsRoot) {
    throw new Error("markdownLinkRewriter: docsRoot is required");
  }
  const trimmedBase = routeBase === "/" ? "" : routeBase.replace(/\/$/, "");

  return function transformer(tree, file) {
    const filePath = file?.path;
    if (!filePath) return;
    const fileDir = path.dirname(filePath);

    visit(tree, "link", (node) => {
      const url = node.url;
      if (typeof url !== "string" || url.length === 0) return;

      // External: scheme:something (http:, https:, mailto:, ftp:, …).
      if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return;
      // Absolute path or bare fragment / query → leave alone.
      if (url.startsWith("/") || url.startsWith("#") || url.startsWith("?")) return;

      // Only rewrite .md / .mdx hrefs (with optional #frag or ?query suffix).
      const match = url.match(/^([^#?]+\.(?:md|mdx))(.*)$/i);
      if (!match) return;
      const [, relPath, suffix] = match;

      const absolute = path.resolve(fileDir, relPath);
      const slug = toCleanSlug(docsRoot, absolute);
      node.url = buildHref(trimmedBase, slug, suffix);
    });
  };
}
