import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools";
import {
  getToken,
  unpackEventFromToken,
  validateEvent,
} from "nostr-tools/nip98";
import { describe, expect, it } from "vitest";

describe("nip98 round-trip", () => {
  it("issues a token that unpacks and validates", async () => {
    const sk = generateSecretKey();
    const pubkey = getPublicKey(sk);
    const url = "http://localhost:3000/api/auth/nostr/login";
    const payload = { nonce: "deadbeef".repeat(4) };

    const token = await getToken(
      url,
      "post",
      (event) => finalizeEvent(event, sk),
      true,
      payload,
    );
    expect(token.startsWith("Nostr ")).toBe(true);

    const event = await unpackEventFromToken(token);
    expect(event.pubkey).toBe(pubkey);
    await validateEvent(event, url, "post", payload);
  });

  it("rejects a token whose payload was tampered with", async () => {
    const sk = generateSecretKey();
    const url = "http://localhost:3000/api/auth/nostr/login";
    const token = await getToken(
      url,
      "post",
      (event) => finalizeEvent(event, sk),
      true,
      { nonce: "aaaa" },
    );
    const event = await unpackEventFromToken(token);
    await expect(
      validateEvent(event, url, "post", { nonce: "bbbb" }),
    ).rejects.toThrow();
  });

  it("rejects a token signed for a different URL", async () => {
    const sk = generateSecretKey();
    const payload = { nonce: "aaaa" };
    const token = await getToken(
      "http://localhost:3000/nostr/login",
      "post",
      (event) => finalizeEvent(event, sk),
      true,
      payload,
    );
    const event = await unpackEventFromToken(token);
    await expect(
      validateEvent(
        event,
        "http://localhost:3000/api/auth/nostr/login",
        "post",
        payload,
      ),
    ).rejects.toThrow();
  });
});
