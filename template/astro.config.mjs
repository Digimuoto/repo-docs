import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";
import tailwind from "@astrojs/tailwind";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

const site = process.env.DOCS_SITE_URL || "http://127.0.0.1:4321";
const base = process.env.DOCS_ROUTE_BASE || "/";

export default defineConfig({
  site,
  base,
  markdown: {
    remarkPlugins: [remarkMath],
    rehypePlugins: [rehypeKatex],
    // Dual-theme syntax highlighting: emit both palettes as CSS vars
    // and let global.css activate one based on the <html> theme class.
    // This keeps a single build serving either theme without rebuilding.
    shikiConfig: {
      themes: {
        light: "github-light",
        dark: "github-dark",
      },
      defaultColor: false,
    },
  },
  integrations: [tailwind(), mdx()],
});
