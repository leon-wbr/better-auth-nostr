import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as clientExports from "../src/client";
import * as serverExports from "../src/index";

const root = resolve(import.meta.dirname, "..");
const docsDir = join(root, "docs");
const docs = readdirSync(docsDir, { recursive: true, encoding: "utf8" })
  .filter((file) => file.endsWith(".md"))
  .map((file) => join(docsDir, file));
const read = (path: string) => readFileSync(path, "utf8");
const reference = read(join(docsDir, "reference.md"));

const headings = new Set(
  reference
    .split("\n")
    .filter((line) => line.startsWith("#"))
    .map((line) => line.replace(/^#+\s*/, "").trim()),
);
const undocumentedHeadings = (names: Iterable<string>) =>
  [...names].filter((name) => !headings.has(name));

const endpoints = Object.values(serverExports.nostr().endpoints).map(
  (endpoint) => `${endpoint.options.method} ${endpoint.path}`,
);

describe("docs/reference.md", () => {
  it("documents every endpoint", () => {
    expect(endpoints).toHaveLength(6);
    expect(undocumentedHeadings(endpoints)).toEqual([]);
  });

  it("documents every endpoint the client calls", () => {
    const { pathMethods } = clientExports.nostrClient();
    const called = Object.entries(pathMethods).map(
      ([path, method]) => `${method} ${path}`,
    );
    expect(called.filter((endpoint) => !endpoints.includes(endpoint))).toEqual(
      [],
    );
  });

  it("documents every client action", () => {
    const { $Infer: _, ...groups } = clientExports
      .nostrClient({ relays: ["wss://relay.example.com"] })
      .getActions({} as never, {} as never, undefined);
    const actions = Object.entries(groups).flatMap(([group, members]) =>
      Object.keys(members).map((name) => `${group}.${name}`),
    );
    expect(actions).toContain("nostr.getProfile");
    expect(undocumentedHeadings(actions)).toEqual([]);
  });
});

describe("docs/", () => {
  it.each(
    docs.map((path) => [relative(root, path), path]),
  )("%s has no Liquid tags, which GitHub Pages' Jekyll would evaluate", (_, path) => {
    const liquid = read(path)
      .split("\n")
      .filter((line) => /\{\{|\{%/.test(line));
    expect(liquid).toEqual([]);
  });
});

describe("relative links", () => {
  const LINK = /\]\(([^)\s]+)\)|href="([^"]+)"/g;
  const files = [join(root, "README.md"), ...docs];

  it.each(
    files.map((path) => [relative(root, path), path]),
  )("%s links only to files that exist", (_, path) => {
    const broken = [...read(path).matchAll(LINK)]
      .map((match) => match[1] ?? match[2] ?? "")
      .filter((target) => !/^([a-z]+:|#)/i.test(target))
      .filter((target) => {
        const file = resolve(dirname(path), target.replace(/[#?].*$/, ""));
        // The site is built from docs/ alone; a link out of it 404s there.
        const escapes =
          path.startsWith(docsDir) && relative(docsDir, file).startsWith("..");
        return escapes || !existsSync(file);
      });
    expect(broken).toEqual([]);
  });
});
