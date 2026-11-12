import { finalizeEvent, verifyEvent } from "nostr-tools";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createExtensionSigner } from "../src/signer";
import { makeKeypair } from "./helpers";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createExtensionSigner", () => {
  it("delegates both calls to window.nostr", async () => {
    const keypair = makeKeypair();
    vi.stubGlobal("window", {
      nostr: {
        getPublicKey: async () => keypair.publicKey,
        signEvent: async (event: Parameters<typeof finalizeEvent>[0]) =>
          finalizeEvent(event, keypair.secretKey),
      },
    });

    const signer = createExtensionSigner();
    expect(signer).not.toBeNull();
    expect(await signer!.getPublicKey()).toBe(keypair.publicKey);

    const event = await signer!.signEvent({
      kind: 1,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: "hello",
    });
    expect(event.pubkey).toBe(keypair.publicKey);
    expect(verifyEvent(event)).toBe(true);
  });

  it("returns null without an extension", () => {
    vi.stubGlobal("window", {});
    expect(createExtensionSigner()).toBeNull();
  });
});
