import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";
import tailwind from "@astrojs/tailwind";
import {existsSync, readFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {visit} from "unist-util-visit";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import {markdownLinkRewriter} from "./src/integrations/markdown-link-rewriter.mjs";
import {treeSitterHighlight} from "./src/integrations/tree-sitter-highlight.mjs";

const site = process.env.DOCS_SITE_URL || "http://127.0.0.1:4321";
const base = process.env.DOCS_ROUTE_BASE || "/";

// Load the staged grammar manifest once; when it's empty (or missing),
// skip the rehype plugin so builds without custom languages pay zero
// tree-sitter cost. The manifest also seeds a Shiki transformer that
// stamps registered-language <pre> elements with a `data-ts-lang`
// attribute, which is how the rehype plugin finds them later — Shiki
// collapses any unknown language tag to "plaintext", so without this
// stamp the original fenced tag would be lost by the time the rehype
// plugin runs.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const docsContentRoot = path.resolve(__dirname, "src/content/docs");
const grammarManifestPath = path.resolve(__dirname, "src/generated/grammars.json");
let hasCustomGrammars = false;
const registeredLangs = new Set();
if (existsSync(grammarManifestPath)) {
  try {
    const parsed = JSON.parse(readFileSync(grammarManifestPath, "utf8"));
    if (parsed && typeof parsed === "object") {
      for (const [name, entry] of Object.entries(parsed)) {
        registeredLangs.add(name);
        for (const alias of entry.aliases ?? []) registeredLangs.add(alias);
      }
    }
    hasCustomGrammars = registeredLangs.size > 0;
  } catch {
    hasCustomGrammars = false;
  }
}

/*
 * Remark plugin: for any fenced code block whose language tag is
 * registered with a tree-sitter grammar, stash the original tag into
 * the block's `meta` string. Shiki falls back to "plaintext" for
 * unknown languages and rewrites `data-language` accordingly, so by
 * the time the rehype stage runs, the original tag is lost unless we
 * carry it through here. A Shiki transformer (below) then promotes it
 * to a real HAST attribute (`data-ts-lang`) that the rehype plugin
 * keys off.
 */
const META_MARK = "__repoDocsTsLang=";

function markRegisteredLanguages() {
  return (tree) => {
    visit(tree, "code", (node) => {
      if (!node.lang || !registeredLangs.has(node.lang)) return;
      const marker = `${META_MARK}${node.lang}`;
      if (!node.meta) {
        node.meta = marker;
      } else if (!node.meta.includes(META_MARK)) {
        node.meta = `${node.meta} ${marker}`;
      }
    });
  };
}

const preserveOriginalLang = hasCustomGrammars
  ? [
      {
        name: "preserve-custom-lang",
        pre(node) {
          // Shiki collapses unknown `options.lang` to "plaintext" before
          // transformers run, so we recover the original fenced tag
          // from the meta string that markRegisteredLanguages injected
          // upstream. The marker is stripped from user-visible meta by
          // Shiki already (it doesn't render meta), so it's only used
          // for this handoff.
          const rawMeta =
            typeof this.options?.meta === "string"
              ? this.options.meta
              : this.options?.meta?.__raw ?? "";
          const match = rawMeta.match(
            new RegExp(`${META_MARK.replace(/[-/\\^$*+?.()|[\\]{}]/g, "\\\\$&")}([^\\s]+)`),
          );
          if (match) {
            node.properties["data-ts-lang"] = match[1];
          }
        },
      },
    ]
  : [];

export default defineConfig({
  site,
  base,
  markdown: {
    remarkPlugins: [
      remarkMath,
      ...(hasCustomGrammars ? [markRegisteredLanguages] : []),
      [markdownLinkRewriter, {docsRoot: docsContentRoot, routeBase: base}],
    ],
    rehypePlugins: [
      rehypeKatex,
      ...(hasCustomGrammars
        ? [[treeSitterHighlight, {manifestPath: grammarManifestPath}]]
        : []),
    ],
    // Dual-theme syntax highlighting: emit both palettes as CSS vars
    // and let global.css activate one based on the <html> theme class.
    // This keeps a single build serving either theme without rebuilding.
    shikiConfig: {
      themes: {
        light: "github-light",
        dark: "github-dark",
      },
      defaultColor: false,
      // Tell Shiki that registered tree-sitter languages are plaintext
      // aliases. Without this, Shiki logs a noisy
      //   [Shiki] The language "wire" doesn't exist, falling back to "plaintext".
      // for every block before the rehype plugin re-tokenises them via
      // tree-sitter. Aliasing to plaintext suppresses the warning while
      // leaving the original tag intact through the meta-string
      // round-trip below.
      langAlias: Object.fromEntries(
        [...registeredLangs].map((lang) => [lang, "plaintext"]),
      ),
      transformers: preserveOriginalLang,
    },
  },
  integrations: [tailwind(), mdx()],
});
