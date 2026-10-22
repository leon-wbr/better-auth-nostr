import { finalizeEvent } from "nostr-tools";
import { describe, expect, it } from "vitest";
import type { NostrOptions } from "../src/types";
import {
  createTestAuth,
  type Keypair,
  makeKeypair,
  performLogin,
} from "./helpers";

type LoginBody = {
  user: { name: string; image?: string | null; email: string };
};

const metadataEvent = (keypair: Keypair, metadata: unknown) =>
  finalizeEvent(
    {
      kind: 0,
      created_at: 1_700_000_000,
      tags: [],
      content: JSON.stringify(metadata),
    },
    keypair.secretKey,
  );

const poolReturning = (events: ReturnType<typeof metadataEvent>[]) => ({
  querySync: async () => events,
});

const failingPool = {
  querySync: async () => {
    throw new Error("relay down");
  },
};

const signUp = async (
  keypair: Keypair,
  profileAutofill: NostrOptions["profileAutofill"],
) => {
  const auth = createTestAuth({ profileAutofill });
  const res = await performLogin(auth, keypair);
  expect(res.status).toBe(200);
  return ((await res.json()) as LoginBody).user;
};

describe("profileAutofill on implicit sign-up", () => {
  it("is off by default and never touches relays", async () => {
    const keypair = makeKeypair();
    const user = await signUp(keypair, undefined);
    expect(user.name.startsWith("npub")).toBe(true);
    expect(user.image ?? null).toBeNull();
  });

  it("fills name and image from kind 0 metadata", async () => {
    const keypair = makeKeypair();
    const user = await signUp(keypair, {
      pool: poolReturning([
        metadataEvent(keypair, {
          name: "alice",
          display_name: "Alice",
          picture: "https://example.com/a.png",
        }),
      ]),
    });
    expect(user.name).toBe("Alice");
    expect(user.image).toBe("https://example.com/a.png");
  });

  it("falls back to name when display_name is absent or blank", async () => {
    const keypair = makeKeypair();
    const user = await signUp(keypair, {
      pool: poolReturning([
        metadataEvent(keypair, { name: "alice", display_name: "  " }),
      ]),
    });
    expect(user.name).toBe("alice");
  });

  it("never takes the email from metadata", async () => {
    const keypair = makeKeypair();
    const user = await signUp(keypair, {
      pool: poolReturning([
        metadataEvent(keypair, { name: "alice", nip05: "alice@example.com" }),
      ]),
    });
    expect(user.email.endsWith("@nostr.local")).toBe(true);
  });

  it("ignores pictures that are not http(s) URLs", async () => {
    const keypair = makeKeypair();
    const user = await signUp(keypair, {
      pool: poolReturning([
        metadataEvent(keypair, {
          name: "alice",
          picture: "javascript:alert(1)",
        }),
      ]),
    });
    expect(user.name).toBe("alice");
    expect(user.image ?? null).toBeNull();
  });

  it("ignores an over-long picture URL", async () => {
    const keypair = makeKeypair();
    const user = await signUp(keypair, {
      pool: poolReturning([
        metadataEvent(keypair, {
          name: "alice",
          picture: `https://example.com/${"a".repeat(3000)}.png`,
        }),
      ]),
    });
    expect(user.name).toBe("alice");
    expect(user.image ?? null).toBeNull();
  });

  it("truncates an over-long name", async () => {
    const keypair = makeKeypair();
    const user = await signUp(keypair, {
      pool: poolReturning([metadataEvent(keypair, { name: "x".repeat(500) })]),
    });
    expect(user.name).toHaveLength(120);
  });

  it("keeps the npub name when no profile is found", async () => {
    const keypair = makeKeypair();
    const user = await signUp(keypair, { pool: poolReturning([]) });
    expect(user.name.startsWith("npub")).toBe(true);
  });

  it("still signs the user up when the relay query fails", async () => {
    const keypair = makeKeypair();
    const user = await signUp(keypair, { pool: failingPool });
    expect(user.name.startsWith("npub")).toBe(true);
  });

  it("does not rewrite an existing user's profile on later logins", async () => {
    const keypair = makeKeypair();
    let events = [metadataEvent(keypair, { name: "alice" })];
    const auth = createTestAuth({
      profileAutofill: { pool: { querySync: async () => events } },
    });
    await performLogin(auth, keypair);

    events = [metadataEvent(keypair, { name: "changed" })];
    const second = await performLogin(auth, keypair);
    expect(((await second.json()) as LoginBody).user.name).toBe("alice");
  });

  it("passes configured relays and timeout to the lookup", async () => {
    const keypair = makeKeypair();
    const calls: { relays: string[]; opts: any }[] = [];
    await signUp(keypair, {
      relays: ["wss://relay.example.com"],
      timeoutMs: 1234,
      pool: {
        querySync: async (relays: string[], _f: unknown, opts: unknown) => {
          calls.push({ relays, opts });
          return [];
        },
      },
    });
    expect(calls[0]?.relays).toEqual(["wss://relay.example.com"]);
    expect(calls[0]?.opts).toEqual({ maxWait: 1234 });
  });
});
