import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";
import tailwind from "@astrojs/tailwind";

const site = process.env.DOCS_SITE_URL || "http://127.0.0.1:4321";

export default defineConfig({
  site,
  integrations: [tailwind(), mdx()],
});
