import { readFileSync, writeFileSync } from "node:fs";
import { NOSTR_ERROR_CODES, nostr } from "../../dist/index.mjs";
import { ERROR_DOCS } from "./error-codes.ts";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const pkg = JSON.parse(read("package.json"));
const lock = JSON.parse(read("package-lock.json"));
const locked = (name: string) => lock.packages[`node_modules/${name}`].version;
const matrix = read(".github/workflows/matrix.yml");
const axis = (name: string) =>
  (matrix.match(new RegExp(`${name}: \\[(.*)\\]`))?.[1] ?? "")
    .split(",")
    .map((value) => value.trim().replaceAll('"', ""));
const list = (values: string[]) =>
  values.length > 1
    ? `${values.slice(0, -1).join(", ")} and ${values.at(-1)}`
    : values.join("");
const nodes = axis("node");
const betterAuths = axis("better-auth");
const runtimes = axis("runtime");
const job = (name: string) =>
  `[\`${name}\`](https://github.com/leon-wbr/better-auth-nostr/blob/main/.github/workflows/matrix.yml)`;
const issue31 =
  "[#31](https://github.com/leon-wbr/better-auth-nostr/issues/31)";

const table = (head: string[], rows: string[][]) =>
  [head, head.map(() => "---"), ...rows]
    .map((cells) => `| ${cells.join(" | ")} |`)
    .join("\n");

const codes = Object.keys(NOSTR_ERROR_CODES);
const documented = Object.keys(ERROR_DOCS);
if (codes.join() !== documented.join()) {
  throw new Error(
    `scripts/docs/error-codes.ts must list ${codes.join(", ")} in that order`,
  );
}
const errorTable = (from: "server" | "client") =>
  table(
    ["Code", "Status", "When", "What to do"],
    Object.entries(ERROR_DOCS)
      .filter(([, doc]) => doc.from === from)
      .map(([code, doc]) => [`\`${code}\``, doc.status, doc.when, doc.fix]),
  );

type Field = {
  type: string;
  required?: boolean;
  unique?: boolean;
  index?: boolean;
  references?: { model: string; field: string; onDelete?: string };
};
const yes = (flag?: boolean) => (flag ? "yes" : "");

/** Area, what is supported, what checks it today, and what will. */
const SUPPORT: [string, string, string, string?][] = [
  [
    "Better Auth",
    `\`${pkg.peerDependencies["better-auth"]}\` (peer dependency). 1.7.0 is the floor: the nonce flow needs \`consumeVerificationValue\`.`,
    `Proven by the ${job("test")} job at ${list(betterAuths)}, and by \`check\` at ${locked("better-auth")} from the lockfile.`,
  ],
  [
    "Node",
    `${list(nodes)} (\`engines\`: \`${pkg.engines.node}\`). Node 20 is end-of-life and has no global \`WebSocket\`, which relay lookups and remote signers need.`,
    `Proven by the ${job("test")} job on Node ${list(nodes)}.`,
  ],
  [
    "Bun, Deno 2, Cloudflare Workers (`nodejs_compat`)",
    "Server and client.",
    `Proven by the ${job("smoke")} jobs (${list(runtimes)}), each a full sign-in against the built package.`,
  ],
  [
    "Databases",
    "Better Auth's memory adapter, SQLite through Kysely, and Postgres. Other adapters are expected to work.",
    `Proven by the adapter suite in the ${job("test")} job: the memory adapter, \`node:sqlite\` and a Postgres 17 service, including one nonce used twice at once and two users linking one key at once.`,
  ],
  [
    "Browsers",
    "Evergreen Chrome, Firefox and Safari.",
    "Nothing automated.",
    "The [manual signer checklist](signer-checklist.md), run on each release candidate from 1.0.0-rc.1",
  ],
  [
    "nostr-tools",
    `\`${pkg.dependencies["nostr-tools"]}\` (dependency). 2.20 is the first with the \`AbortSignal\` the \`nostrconnect://\` flow needs.`,
    `The test suite, at ${locked("nostr-tools")} from the lockfile.`,
  ],
  [
    "NIPs",
    "01 and 24 (kind `0` profiles), 05, 07, 19, 46 (`bunker://` and `nostrconnect://`), 98. NIP-65 and NIP-55 are not supported yet ([#41](https://github.com/leon-wbr/better-auth-nostr/issues/41)).",
    "Unit and integration tests.",
  ],
  [
    "Signers",
    "NIP-07 extensions such as Alby and nos2x; NIP-46 signers such as nsec.app and Amber; any object matching `NostrSigner`.",
    "Nothing automated. Reports of a signer that works or doesn't are welcome as issues.",
    "The [manual signer checklist](signer-checklist.md), with the version each signer was last verified on, from 1.0.0-rc.1",
  ],
];

const blocks: Record<string, Record<string, string>> = {
  "docs/reference.md": {
    "server-errors": errorTable("server"),
    "client-errors": errorTable("client"),
    schema: table(
      ["Field", "Type", "Required", "Unique", "Indexed", "References"],
      Object.entries(nostr().schema.nostrPubkey.fields).map(
        ([name, field]: [string, Field]) => [
          `\`${name}\``,
          field.type,
          yes(field.required),
          yes(field.unique),
          yes(field.index),
          field.references
            ? `\`${field.references.model}.${field.references.field}\`, on delete ${field.references.onDelete}`
            : "",
        ],
      ),
    ),
  },
  "docs/support.md": {
    "support-matrix": table(
      ["Area", "Supported", "Checked by", "Planned"],
      SUPPORT.map(([area, supported, checked, planned]) => [
        area,
        supported,
        checked,
        planned ? `${planned}, ${issue31}` : "",
      ]),
    ),
  },
};

for (const [file, contents] of Object.entries(blocks)) {
  let markdown = read(file);
  for (const [name, content] of Object.entries(contents)) {
    const block = new RegExp(
      `(<!-- generated:${name} -->)[\\s\\S]*?(<!-- /generated:${name} -->)`,
    );
    if (!block.test(markdown)) throw new Error(`No ${name} block in ${file}`);
    // Kramdown only parses a table set off from the comments by blank lines.
    markdown = markdown.replace(
      block,
      (_, start, end) => `${start}\n\n${content}\n\n${end}`,
    );
  }
  writeFileSync(new URL(file, root), markdown);
}
