import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { unified } from "@astrojs/markdown-remark";
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

const base = "/better-auth-nostr";
const repo = "https://github.com/leon-wbr/better-auth-nostr";
const docs = fileURLToPath(new URL("../../docs/", import.meta.url));

type Node = { type: string; url?: string; children?: Node[] };

/** Rewrites the `guide.md#x` links that work on GitHub to the site's `/guide/#x`. */
const remarkMarkdownLinks = () => (tree: Node, file: { path: string }) => {
  const walk = (node: Node) => {
    const match =
      node.type === "link" &&
      /^(?![a-z]+:|#|\/)(.*?)\.mdx?(#.*)?$/i.exec(node.url ?? "");
    if (match) {
      const slug = relative(docs, resolve(dirname(file.path), match[1]))
        .replace(/(^|\/)index$/, "")
        .toLowerCase();
      node.url = `${base}/${slug ? `${slug}/` : ""}${match[2] ?? ""}`;
    }
    node.children?.forEach(walk);
  };
  walk(tree);
};

export default defineConfig({
  site: "https://leon-wbr.github.io",
  base,
  markdown: { processor: unified({ remarkPlugins: [remarkMarkdownLinks] }) },
  integrations: [
    starlight({
      title: "Better Auth Nostr",
      description: "Sign in with Nostr for Better Auth.",
      social: [{ icon: "github", label: "GitHub", href: repo }],
      // Entry paths are relative to this directory: `../../docs/guide.md`.
      editLink: { baseUrl: `${repo}/edit/main/scripts/docs/` },
      customCss: [
        "@fontsource-variable/geist",
        "@fontsource-variable/geist-mono",
        "./theme.css",
      ],
      sidebar: [
        {
          label: "Get started",
          items: [{ label: "Installation", slug: "index" }],
        },
        { label: "Guides", items: ["guide", "interop", "key-loss"] },
        {
          label: "Reference",
          items: [
            "reference",
            {
              label: "API",
              items: [
                { label: "Server", slug: "api/better-auth-nostr" },
                { label: "Client", slug: "api/better-auth-nostr/client" },
              ],
            },
          ],
        },
        {
          label: "Project",
          items: [
            "support",
            "signer-checklist",
            { label: "Changelog", link: `${repo}/blob/main/CHANGELOG.md` },
            {
              label: "Contributing",
              link: `${repo}/blob/main/CONTRIBUTING.md`,
            },
          ],
        },
      ],
    }),
  ],
});
