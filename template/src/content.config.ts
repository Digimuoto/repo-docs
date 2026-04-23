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
  }),
});

export const collections = {docs};
