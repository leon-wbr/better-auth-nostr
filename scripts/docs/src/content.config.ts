import { defineCollection } from "astro:content";
import { docsSchema } from "@astrojs/starlight/schema";
import { glob } from "astro/loaders";

export const collections = {
  docs: defineCollection({
    loader: glob({ base: "../../docs", pattern: "**/*.{md,mdx}" }),
    schema: docsSchema(),
  }),
};
