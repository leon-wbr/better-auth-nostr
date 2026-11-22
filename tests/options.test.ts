import { readFileSync } from "node:fs";
import type { BetterAuthPluginDBSchema } from "@better-auth/core/db";
import type { MemoryDB } from "better-auth/adapters/memory";
import { nip19 } from "nostr-tools";
import { describe, expect, it, vi } from "vitest";
import { nostrClient } from "../src/client";
import { nostr } from "../src/index";
import type { NostrOptions } from "../src/types";
import {
  createTestAuth,
  issueNonce,
  makeKeypair,
  performLogin,
  signLoginToken,
} from "./helpers";

type Model = BetterAuthPluginDBSchema[string];

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

const initWarnings = async (options: NostrOptions, db?: MemoryDB) => {
  const log = vi.fn();
  await createTestAuth(options, { logger: { log }, ...(db && { db }) })
    .$context;
  return log.mock.calls
    .filter(([level]) => level === "warn")
    .map(([, message]) => String(message));
};

const signInUnknownKey = async (options: NostrOptions) => {
  const auth = createTestAuth(options);
  const keypair = makeKeypair();
  const nonce = await issueNonce(auth, keypair);
  return auth.api.signInNostr({
    body: { nonce },
    headers: new Headers({
      authorization: await signLoginToken(keypair, nonce),
    }),
  });
};

describe("disableSignUp", () => {
  it.each([
    { disableSignUp: true },
    { disableImplicitSignUp: true },
  ])("rejects an unknown pubkey with %o", async (options) => {
    await expect(signInUnknownKey(options)).rejects.toMatchObject({
      statusCode: 401,
      body: { code: "NOSTR_PUBKEY_NOT_REGISTERED" },
    });
  });

  it("warns that disableImplicitSignUp is deprecated", async () => {
    expect(await initWarnings({ disableImplicitSignUp: true })).toEqual([
      expect.stringMatching(/disableImplicitSignUp.*deprecated.*disableSignUp/),
    ]);
  });

  it("does not warn for disableSignUp", async () => {
    expect(await initWarnings({ disableSignUp: true })).toEqual([]);
  });
});

describe("schema option", () => {
  const renamed = {
    nostrPubkey: {
      modelName: "nostrIdentity",
      fields: { publicKey: "pub_key", userId: "owner_id" },
    },
  };

  it("renames the model and its columns through Better Auth's schema option", async () => {
    const schema: Model = nostr({ schema: renamed }).schema.nostrPubkey;
    expect(schema.modelName).toBe("nostrIdentity");
    expect(schema.fields.publicKey?.fieldName).toBe("pub_key");
    expect(schema.fields.userId?.fieldName).toBe("owner_id");
    expect(schema.fields.createdAt?.fieldName).toBeUndefined();

    const db: MemoryDB = { nostrIdentity: [] };
    const auth = createTestAuth({ schema: renamed }, { db });
    expect((await performLogin(auth, makeKeypair())).status).toBe(200);
    expect(db.nostrIdentity?.[0]).toHaveProperty("pub_key");
  });

  it("keeps modelName and fields as deprecated aliases", async () => {
    const legacy = {
      modelName: "nostrIdentity",
      fields: { publicKey: "pub_key" },
    };
    const schema: Model = nostr(legacy).schema.nostrPubkey;
    expect(schema.modelName).toBe("nostrIdentity");
    expect(schema.fields.publicKey?.fieldName).toBe("pub_key");

    expect(await initWarnings(legacy, { nostrIdentity: [] })).toEqual([
      expect.stringMatching(/modelName.*deprecated.*schema/),
      expect.stringMatching(/fields.*deprecated.*schema/),
    ]);
  });

  it("lets schema win over the deprecated aliases", () => {
    const schema = nostr({ modelName: "old", schema: renamed }).schema
      .nostrPubkey;
    expect(schema.modelName).toBe("nostrIdentity");
  });
});

describe("placeholder email", () => {
  it("gives a new user Better Auth's placeholder email, on a reserved domain", async () => {
    const keypair = makeKeypair();
    const res = await performLogin(createTestAuth(), keypair);
    const { user } = (await res.json()) as { user: { email: string } };
    expect(user.email).toBe(
      `${nip19.npubEncode(keypair.publicKey)}@nostr.placeholder.invalid`,
    );
  });
});

describe("plugin metadata", () => {
  it("reports the package version on both plugins", () => {
    expect(nostr().version).toBe(pkg.version);
    expect(nostrClient().version).toBe(pkg.version);
  });

  it("maps each subpath to its own types for moduleResolution node10", () => {
    expect(pkg.typesVersions).toEqual({
      "*": {
        client: ["./dist/client.d.mts"],
        "*": ["./dist/index.d.mts"],
      },
    });
  });
});
