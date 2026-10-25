import { finalizeEvent } from "nostr-tools";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NostrOptions } from "../src/types";
import {
  createTestAuth,
  type Keypair,
  makeKeypair,
  performLogin,
} from "./helpers";

const relay = vi.hoisted(() => ({
  calls: [] as { relays: string[]; params: any }[],
  event: null as unknown,
  fail: false,
}));

vi.mock("nostr-tools/pool", () => ({
  SimplePool: class {
    async get(relays: string[], _filter: unknown, params: unknown) {
      relay.calls.push({ relays, params });
      if (relay.fail) throw new Error("relay down");
      return relay.event;
    }
    close() {}
  },
}));

beforeEach(() => {
  relay.calls = [];
  relay.event = null;
  relay.fail = false;
});

type LoginUser = {
  name: string;
  image?: string | null;
  email: string;
  [key: string]: unknown;
};

const RELAYS: [string] = ["wss://relay.example.com"];

const publishProfile = (keypair: Keypair, metadata: unknown) => {
  relay.event = finalizeEvent(
    {
      kind: 0,
      created_at: 1_700_000_000,
      tags: [],
      content: JSON.stringify(metadata),
    },
    keypair.secretKey,
  );
};

const login = async (
  auth: ReturnType<typeof createTestAuth>,
  keypair: Keypair,
) => {
  const res = await performLogin(auth, keypair);
  expect(res.status).toBe(200);
  return ((await res.json()) as { user: LoginUser }).user;
};

const signUp = (keypair: Keypair, options: NostrOptions = {}) =>
  login(
    createTestAuth({ relays: RELAYS, fetchProfileOnSignIn: true, ...options }),
    keypair,
  );

describe("fetchProfileOnSignIn", () => {
  it("is off by default and never touches relays", async () => {
    const keypair = makeKeypair();
    publishProfile(keypair, { name: "alice" });
    const user = await login(createTestAuth({ relays: RELAYS }), keypair);
    expect(user.name.startsWith("npub")).toBe(true);
    expect(relay.calls).toHaveLength(0);
  });

  it("fills name and image from kind 0 metadata", async () => {
    const keypair = makeKeypair();
    publishProfile(keypair, {
      name: "alice",
      display_name: "Alice",
      picture: "https://example.com/a.png",
    });
    const user = await signUp(keypair);
    expect(user.name).toBe("Alice");
    expect(user.image).toBe("https://example.com/a.png");
  });

  it("falls back to name when display_name is absent or blank", async () => {
    const keypair = makeKeypair();
    publishProfile(keypair, { name: " alice ", display_name: "  " });
    expect((await signUp(keypair)).name).toBe("alice");
  });

  it("never takes the email from metadata", async () => {
    const keypair = makeKeypair();
    publishProfile(keypair, { name: "alice", nip05: "alice@example.com" });
    expect((await signUp(keypair)).email.endsWith("@nostr.local")).toBe(true);
  });

  it.each([
    "javascript:alert(1)",
    "http://example.com/a.png",
  ])("ignores a picture that is not an https URL: %s", async (picture) => {
    const keypair = makeKeypair();
    publishProfile(keypair, { name: "alice", picture });
    const user = await signUp(keypair);
    expect(user.name).toBe("alice");
    expect(user.image ?? null).toBeNull();
  });

  it("queries only the configured relays, with the configured timeout", async () => {
    const keypair = makeKeypair();
    await signUp(keypair, {
      relays: ["wss://relay.example.com"],
      relayTimeoutMs: 1234,
    });
    expect(relay.calls).toEqual([
      { relays: ["wss://relay.example.com/"], params: { maxWait: 1234 } },
    ]);
  });

  it("keeps the npub name when no profile is found", async () => {
    const keypair = makeKeypair();
    expect((await signUp(keypair)).name.startsWith("npub")).toBe(true);
  });

  it("still signs the user up when the relay query fails", async () => {
    const keypair = makeKeypair();
    relay.fail = true;
    expect((await signUp(keypair)).name.startsWith("npub")).toBe(true);
  });

  it("does not change an existing user on later sign-ins by default", async () => {
    const keypair = makeKeypair();
    const auth = createTestAuth({
      relays: RELAYS,
      fetchProfileOnSignIn: true,
    });
    publishProfile(keypair, { name: "alice" });
    await login(auth, keypair);

    publishProfile(keypair, { name: "changed" });
    relay.calls = [];
    expect((await login(auth, keypair)).name).toBe("alice");
    expect(relay.calls).toHaveLength(0);
  });
});

describe("mapProfileToUser", () => {
  it("is spread over the default mapping", async () => {
    const keypair = makeKeypair();
    publishProfile(keypair, {
      display_name: "Alice",
      picture: "https://example.com/a.png",
    });
    const user = await signUp(keypair, {
      mapProfileToUser: ({ metadata }) => ({
        name: metadata.display_name?.toUpperCase(),
      }),
    });
    expect(user.name).toBe("ALICE");
    expect(user.image).toBe("https://example.com/a.png");
  });

  it("can be async", async () => {
    const keypair = makeKeypair();
    publishProfile(keypair, { name: "alice" });
    const user = await signUp(keypair, {
      mapProfileToUser: async () => ({ image: "http://example.com/a.png" }),
    });
    expect(user.image).toBe("http://example.com/a.png");
  });

  it("cannot set the email or id", async () => {
    const keypair = makeKeypair();
    publishProfile(keypair, { name: "alice" });
    const user = await signUp(keypair, {
      mapProfileToUser: () =>
        ({ email: "victim@example.com", id: "taken" }) as never,
    });
    expect(user.email.endsWith("@nostr.local")).toBe(true);
    expect(user.id).not.toBe("taken");
  });

  it("passes extra keys through to additional user fields", async () => {
    const keypair = makeKeypair();
    publishProfile(keypair, { name: "alice", lud16: "alice@getalby.com" });
    const auth = createTestAuth(
      {
        relays: RELAYS,
        fetchProfileOnSignIn: true,
        mapProfileToUser: ({ metadata }) => ({
          lud16: metadata.lud16,
          notAField: "dropped",
        }),
      },
      {
        user: {
          additionalFields: { lud16: { type: "string", required: false } },
        },
      },
    );
    const user = await login(auth, keypair);
    expect(user.lud16).toBe("alice@getalby.com");
    expect(user.notAField).toBeUndefined();
  });

  it("does not block sign-up when it throws", async () => {
    const keypair = makeKeypair();
    publishProfile(keypair, { name: "alice" });
    const user = await signUp(keypair, {
      mapProfileToUser: () => {
        throw new Error("bug");
      },
    });
    expect(user.name.startsWith("npub")).toBe(true);
  });
});

describe("overrideUserInfoOnSignIn", () => {
  it("updates an existing user from the profile on every sign-in", async () => {
    const keypair = makeKeypair();
    const auth = createTestAuth({
      relays: RELAYS,
      fetchProfileOnSignIn: true,
      overrideUserInfoOnSignIn: true,
    });
    publishProfile(keypair, { name: "alice" });
    await login(auth, keypair);

    publishProfile(keypair, {
      name: "changed",
      picture: "https://example.com/new.png",
    });
    const user = await login(auth, keypair);
    expect(user.name).toBe("changed");
    expect(user.image).toBe("https://example.com/new.png");
  });

  it("keeps the existing user when the lookup finds nothing", async () => {
    const keypair = makeKeypair();
    const auth = createTestAuth({
      relays: RELAYS,
      fetchProfileOnSignIn: true,
      overrideUserInfoOnSignIn: true,
    });
    publishProfile(keypair, { name: "alice" });
    await login(auth, keypair);

    relay.event = null;
    expect((await login(auth, keypair)).name).toBe("alice");
  });
});
