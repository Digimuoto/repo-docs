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
  },
  integrations: [tailwind(), mdx()],
});
