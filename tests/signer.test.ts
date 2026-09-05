import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  nip19,
} from "nostr-tools";
import { verifyEvent } from "nostr-tools/pure";
import { bytesToHex } from "nostr-tools/utils";
import { describe, expect, it } from "vitest";
import {
  createBunkerSigner,
  createNostrConnectSession,
  createPrivateKeySigner,
  resolveSigner,
} from "../src/signer";

const template = {
  kind: 1,
  tags: [],
  content: "hello",
  created_at: Math.floor(Date.now() / 1000),
};

describe("createPrivateKeySigner", () => {
  it("exposes the pubkey of the given nsec", async () => {
    const sk = generateSecretKey();
    const signer = createPrivateKeySigner(nip19.nsecEncode(sk));
    expect(await signer.getPublicKey()).toBe(getPublicKey(sk));
  });

  it("produces a verifiable event", async () => {
    const sk = generateSecretKey();
    const signed = await createPrivateKeySigner(bytesToHex(sk)).signEvent(
      template,
    );
    expect(verifyEvent(signed)).toBe(true);
    expect(signed.pubkey).toBe(getPublicKey(sk));
  });

  it("rejects an invalid key eagerly", () => {
    expect(() => createPrivateKeySigner("not-an-nsec")).toThrow("Invalid NSEC");
  });
});

describe("resolveSigner", () => {
  it("prefers an explicit signer over an nsec", async () => {
    const sk = generateSecretKey();
    const custom = {
      getPublicKey: async () => "explicit",
      signEvent: async (t: typeof template) => finalizeEvent(t, sk),
    };
    const signer = resolveSigner({
      signer: custom,
      nsec: nip19.nsecEncode(sk),
    });
    expect(await signer.getPublicKey()).toBe("explicit");
  });

  it("falls back to the nsec when no signer is given", async () => {
    const sk = generateSecretKey();
    const signer = resolveSigner({ nsec: nip19.nsecEncode(sk) });
    expect(await signer.getPublicKey()).toBe(getPublicKey(sk));
  });

  it("throws an actionable error when nothing is available", () => {
    expect(() => resolveSigner()).toThrow(/NIP-07/);
    expect(() => resolveSigner()).toThrow(/signer/i);
  });
});

describe("createBunkerSigner input validation", () => {
  it("rejects an empty input", async () => {
    await expect(createBunkerSigner("  ")).rejects.toThrow(/bunker/i);
  });

  it("rejects a string that is neither a bunker URI nor a NIP-05", async () => {
    await expect(createBunkerSigner("totally-not-a-bunker")).rejects.toThrow(
      /bunker:\/\//,
    );
  });

  it("rejects a bunker URI without a relay, before opening a connection", async () => {
    const pubkey = getPublicKey(generateSecretKey());
    await expect(createBunkerSigner(`bunker://${pubkey}`)).rejects.toThrow(
      /relay/i,
    );
  });
});

describe("createNostrConnectSession", () => {
  it("builds a nostrconnect:// URI the signer can scan", () => {
    const session = createNostrConnectSession({
      relays: ["wss://relay.example.com"],
      perms: ["sign_event:27235"],
      name: "Test App",
    });

    const url = new URL(session.uri);
    expect(url.protocol).toBe("nostrconnect:");
    expect(url.hostname || url.pathname.replace(/\//g, "")).toBe(
      getPublicKey(session.clientSecretKey),
    );
    expect(url.searchParams.getAll("relay")).toEqual([
      "wss://relay.example.com",
    ]);
    expect(url.searchParams.get("secret")).toBeTruthy();
    expect(url.searchParams.get("perms")).toBe("sign_event:27235");
    expect(url.searchParams.get("name")).toBe("Test App");
  });

  it("defaults to a usable relay so the URI is never relay-less", () => {
    const session = createNostrConnectSession();
    expect(
      new URL(session.uri).searchParams.getAll("relay").length,
    ).toBeGreaterThan(0);
  });

  it("reuses a caller-supplied client key so sessions can be persisted", () => {
    const clientSecretKey = generateSecretKey();
    const session = createNostrConnectSession({ clientSecretKey });
    expect(bytesToHex(session.clientSecretKey)).toBe(
      bytesToHex(clientSecretKey),
    );
  });

  it("mints a fresh secret per session", () => {
    const secretOf = (uri: string) => new URL(uri).searchParams.get("secret");
    expect(secretOf(createNostrConnectSession().uri)).not.toBe(
      secretOf(createNostrConnectSession().uri),
    );
  });

  it("rejects an empty relay list rather than emitting an unusable URI", () => {
    expect(() => createNostrConnectSession({ relays: [] })).toThrow(/relay/i);
  });
});
