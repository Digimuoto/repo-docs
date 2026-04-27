import {defineCollection, z} from "astro:content";

// Accept either a single string or an array for flexible author attribution
// (one primary author, a team byline, or multiple contributors).
const authorField = z.union([z.string(), z.array(z.string())]).optional();

const docs = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    draft: z.boolean().optional().default(false),

    // Lifecycle status. Renders as a small pill in the nav next to
    // the page label and (optionally) at the top of the rendered
    // page. Free-form: well-known values (draft, proposed, accepted,
    // active, superseded, deprecated, archived) get distinct theme
    // colours; anything else renders in the muted default. Useful
    // for ADRs, plans, research notes, publication drafts.
    status: z.string().optional(),

    // Decision-record cross-references. Both render as clickable
    // pointers in the meta block above the doc body when present.
    //   superseded_by: "docs/cortex/adrs/0014-foo.md" | null
    //   related: ["docs/.../bar.md", "DIG-NNN"]
    superseded_by: z.string().nullable().optional(),
    related: z.array(z.string()).optional(),

    // Doc-type override. When omitted the kind is derived from the
    // top-level path segment (`adrs/...` → `adr`, `publications/...`
    // → `publication`, etc.) so themes can vary per kind without
    // manual frontmatter.
    kind: z.string().optional(),

    // Byline metadata. All optional — when omitted the field is hidden.
    author: authorField,
    authors: authorField,
    date: z.coerce.date().optional(),
    updated: z.coerce.date().optional(),
    tags: z.array(z.string()).optional(),

    sidebar: z
      .object({
        hidden: z.boolean().optional().default(false),
        label: z.string().optional(),
        order: z.number().optional(),
      })
      .optional(),

    // Generated Lean theory pages can point at a pre-rendered Verso
    // HTML fragment under src/generated. Authored pages should omit this.
    verso: z
      .object({
        fragment: z.string(),
      })
      .optional(),

    // Generated Typst manuscript reader pages point at a compiled PDF
    // under public/. Authored pages should omit this.
    typst: z
      .object({
        pdf: z.string(),
      })
      .optional(),
  }),
});

export const collections = {docs};
