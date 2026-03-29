import { defineCollection, z } from "astro:content";

const docs = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    draft: z.boolean().optional().default(false),
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
