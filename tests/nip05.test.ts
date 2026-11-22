import type { MemoryDB } from "better-auth/adapters/memory";
import { finalizeEvent } from "nostr-tools";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyNip05 } from "../src/nip05";
import type { NostrOptions } from "../src/types";
import {
  cookiesFromResponse,
  createTestAuth,
  type Keypair,
  makeKeypair,
  performLogin,
  type TestAuth,
} from "./helpers";

const net = vi.hoisted(() => ({
  relayEvent: null as unknown,
  addresses: [{ address: "93.184.215.14", family: 4 }],
  lookups: [] as string[],
}));

vi.mock("nostr-tools/pool", () => ({
  SimplePool: class {
    async get() {
      return net.relayEvent;
    }
    close() {}
  },
}));

vi.mock("node:dns/promises", () => ({
  lookup: async (host: string) => {
    net.lookups.push(host);
    return net.addresses;
  },
}));

const fetchMock = vi.fn<typeof fetch>();

const serve = (names: Record<string, string>, status = 200) =>
  fetchMock.mockImplementation(
    async () => new Response(JSON.stringify({ names }), { status }),
  );

beforeEach(() => {
  net.relayEvent = null;
  net.addresses = [{ address: "93.184.215.14", family: 4 }];
  net.lookups = [];
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const PUBKEY = "a".repeat(64);
const verify = (claim: string, options = {}) =>
  verifyNip05(claim, PUBKEY, { timeoutMs: 1000, ...options });

describe("verifyNip05", () => {
  it("returns the identifier when nostr.json maps the name to the pubkey", async () => {
    serve({ alice: PUBKEY });

    expect(await verify("alice@example.com")).toBe("alice@example.com");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(
      "https://example.com/.well-known/nostr.json?name=alice",
    );
    expect(init?.redirect).toBe("manual");
  });

  it("returns null when nostr.json maps the name to another pubkey", async () => {
    serve({ alice: "b".repeat(64) });

    expect(await verify("alice@example.com")).toBeNull();
  });

  it("lower-cases the local part and compares pubkeys case-insensitively", async () => {
    serve({ alice: PUBKEY.toUpperCase() });

    expect(await verify("Alice@Example.com")).toBe("alice@example.com");
    expect(String(fetchMock.mock.calls[0]![0])).toContain("name=alice");
  });

  it("uses _ for a bare domain", async () => {
    serve({ _: PUBKEY });

    expect(await verify("example.com")).toBe("_@example.com");
  });

  it.each([
    301, 302,
  ])("refuses a %i redirect to a matching document", async (status) => {
    fetchMock.mockImplementation(
      async () =>
        new Response(JSON.stringify({ names: { alice: PUBKEY } }), {
          status,
          headers: { location: "https://evil.example/nostr.json" },
        }),
    );

    expect(await verify("alice@example.com")).toBeNull();
  });

  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "169.254.169.254",
    "::1",
    "fd12::1",
    "::ffff:10.0.0.1",
  ])("refuses a host that resolves to %s", async (address) => {
    serve({ alice: PUBKEY });
    net.addresses = [
      { address: "93.184.215.14", family: 4 },
      { address, family: address.includes(":") ? 6 : 4 },
    ];

    expect(await verify("alice@example.com")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    "alice@10.0.0.1",
    "alice@169.254.169.254",
    "alice@0x7f.1",
  ])("refuses an IP literal without resolving it: %s", async (claim) => {
    serve({ alice: PUBKEY });

    expect(await verify(claim)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(net.lookups).toEqual([]);
  });

  it("gives up after the timeout", async () => {
    fetchMock.mockImplementation(
      (_, init) =>
        new Promise((_, reject) =>
          init?.signal?.addEventListener("abort", () =>
            reject(init.signal?.reason),
          ),
        ),
    );

    expect(await verify("alice@example.com", { timeoutMs: 20 })).toBeNull();
  });

  it("refuses a response over the size cap", async () => {
    const padding = "x".repeat(300 * 1024);
    fetchMock.mockImplementation(
      async () =>
        new Response(JSON.stringify({ names: { alice: PUBKEY }, padding })),
    );

    expect(await verify("alice@example.com")).toBeNull();
  });

  it("never contacts a domain outside allowedDomains", async () => {
    serve({ alice: PUBKEY });

    expect(
      await verify("alice@evil.example", { allowedDomains: ["example.com"] }),
    ).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(net.lookups).toEqual([]);
  });

  it("matches allowedDomains case-insensitively and exactly", async () => {
    serve({ alice: PUBKEY });
    const allowedDomains = ["Example.com"];

    expect(await verify("alice@EXAMPLE.com", { allowedDomains })).toBe(
      "alice@example.com",
    );
    expect(
      await verify("alice@sub.example.com", { allowedDomains }),
    ).toBeNull();
  });
});

const RELAYS: [string] = ["wss://relay.example.com"];

const publishProfile = (keypair: Keypair, metadata: object) => {
  net.relayEvent = finalizeEvent(
    {
      kind: 0,
      created_at: 1_700_000_000,
      tags: [],
      content: JSON.stringify(metadata),
    },
    keypair.secretKey,
  );
};

const signIn = async (auth: TestAuth, keypair: Keypair) => {
  const res = await performLogin(auth, keypair);
  return { res, headers: cookiesFromResponse(res) };
};

const pubkeysOf = async (auth: TestAuth, headers: Headers) =>
  auth.api.listPubkeys({ headers });

const withNip05 = (verifyNip05: NostrOptions["verifyNip05"]) =>
  createTestAuth({ relays: RELAYS, verifyNip05 });

describe("verifyNip05 option", () => {
  it("fails at init without relays", async () => {
    const auth = createTestAuth({ verifyNip05: true });

    await expect(auth.$context).rejects.toThrow(/verifyNip05 needs relays/);
  });

  it("stores the verified identifier and time at sign-up", async () => {
    const keypair = makeKeypair();
    publishProfile(keypair, { nip05: "Alice@example.com" });
    serve({ alice: keypair.publicKey });
    const auth = withNip05(true);

    const { res, headers } = await signIn(auth, keypair);

    expect(res.status).toBe(200);
    expect(await pubkeysOf(auth, headers)).toEqual([
      expect.objectContaining({
        nip05: "alice@example.com",
        nip05VerifiedAt: expect.any(Date),
      }),
    ]);
  });

  it.each([
    ["a mismatch", { nip05: "alice@example.com" }, { alice: "b".repeat(64) }],
    ["a missing claim", { name: "alice" }, {}],
  ])("stores nothing on %s and still signs up", async (_, metadata, names) => {
    const keypair = makeKeypair();
    publishProfile(keypair, metadata);
    serve(names);
    const auth = withNip05(true);

    const { res, headers } = await signIn(auth, keypair);

    expect(res.status).toBe(200);
    expect(await pubkeysOf(auth, headers)).toEqual([
      expect.objectContaining({ nip05: null, nip05VerifiedAt: null }),
    ]);
  });

  it("refuses sign-up under required and leaves no rows behind", async () => {
    const keypair = makeKeypair();
    publishProfile(keypair, { nip05: "alice@evil.example" });
    serve({ alice: keypair.publicKey });
    const db: MemoryDB = { user: [], account: [], nostrPubkey: [] };
    const auth = createTestAuth(
      {
        relays: RELAYS,
        verifyNip05: { allowedDomains: ["example.com"], required: true },
      },
      { db },
    );

    const { res } = await signIn(auth, keypair);

    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe(
      "NOSTR_IDENTIFIER_NOT_VERIFIED",
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db).toMatchObject({ user: [], account: [], nostrPubkey: [] });
  });

  it("refuses sign-in under required after removal from nostr.json", async () => {
    const keypair = makeKeypair();
    publishProfile(keypair, { nip05: "alice@example.com" });
    serve({ alice: keypair.publicKey });
    const auth = withNip05({ allowedDomains: ["example.com"], required: true });
    expect((await signIn(auth, keypair)).res.status).toBe(200);

    serve({});
    const { res } = await signIn(auth, keypair);

    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe(
      "NOSTR_IDENTIFIER_NOT_VERIFIED",
    );
  });

  it("does not re-verify on sign-in unless required", async () => {
    const keypair = makeKeypair();
    publishProfile(keypair, { nip05: "alice@example.com" });
    serve({ alice: keypair.publicKey });
    const auth = withNip05(true);
    await signIn(auth, keypair);
    fetchMock.mockClear();

    expect((await signIn(auth, keypair)).res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

const sqlite = await import("node:sqlite").catch(() => null);

describe.skipIf(!sqlite)("verifyNip05 on an unmigrated table", () => {
  it("still signs in when the nip05 columns are missing and schema validation is off", async () => {
    const database = new sqlite!.DatabaseSync(":memory:");
    const auth = createTestAuth(
      { relays: RELAYS, verifyNip05: { required: true } },
      { database, advanced: { database: { validateSchema: false } } },
    );
    await auth.$context;
    const { getMigrations } = await import("better-auth/db/migration");
    await (await getMigrations(auth.options)).runMigrations();
    database.exec('ALTER TABLE "nostrPubkey" DROP COLUMN "nip05"');
    database.exec('ALTER TABLE "nostrPubkey" DROP COLUMN "nip05VerifiedAt"');
    const keypair = makeKeypair();
    publishProfile(keypair, { nip05: "alice@example.com" });
    serve({ alice: keypair.publicKey });

    expect((await signIn(auth, keypair)).res.status).toBe(200);
    expect((await signIn(auth, keypair)).res.status).toBe(200);
  });
});
