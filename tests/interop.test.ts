import { NDKPrivateKeySigner, type NDKSigner } from "@nostr-dev-kit/ndk";
import { PrivateKeySigner } from "applesauce-signers";
import { betterAuth } from "better-auth";
import { createAuthClient } from "better-auth/client";
import {
  generateSecretKey,
  getEventHash,
  getPublicKey,
  nip19,
} from "nostr-tools";
import { PlainKeySigner } from "nostr-tools/signer";
import { describe, expect, it, vi } from "vitest";
import { type NostrSigner, nostrClient } from "../src/client";
import { nostr } from "../src/index";
import { TEST_ORIGIN } from "./helpers";

/** The recipes in docs/interop.md, signing in for real. */
const makeClient = () => {
  const auth = betterAuth({
    baseURL: TEST_ORIGIN,
    secret: "test-secret-do-not-use-in-production",
    plugins: [nostr()],
  });
  return createAuthClient({
    baseURL: TEST_ORIGIN,
    plugins: [nostrClient()],
    fetchOptions: {
      customFetchImpl: (input, init) => auth.handler(new Request(input, init)),
    },
  });
};

const signInWith = (signer: NostrSigner) =>
  makeClient().signIn.nostr({ signer });

const npubOf = (secretKey: Uint8Array) =>
  nip19.npubEncode(getPublicKey(secretKey));

describe("applesauce", () => {
  it("signs in with a PrivateKeySigner passed as is", async () => {
    const secretKey = generateSecretKey();
    const { data, error } = await signInWith(
      PrivateKeySigner.fromKey(nip19.nsecEncode(secretKey)),
    );
    expect(error).toBeNull();
    expect(data?.user.name).toBe(npubOf(secretKey));
  });
});

describe("NDK", () => {
  const fromNdk = (signer: NDKSigner): NostrSigner => ({
    getPublicKey: async () => (await signer.user()).pubkey,
    signEvent: async (template) => {
      const event = { ...template, pubkey: (await signer.user()).pubkey };
      const id = getEventHash(event);
      return { ...event, id, sig: await signer.sign({ ...event, id }) };
    },
  });

  it("signs in with a wrapped NDKPrivateKeySigner", async () => {
    const secretKey = generateSecretKey();
    const { data, error } = await signInWith(
      fromNdk(new NDKPrivateKeySigner(secretKey)),
    );
    expect(error).toBeNull();
    expect(data?.user.name).toBe(npubOf(secretKey));
  });
});

describe("window.nostr.js", () => {
  it("picks up a window.nostr that appeared after the client was created", async () => {
    const secretKey = generateSecretKey();
    const signer = new PlainKeySigner(secretKey);
    const client = makeClient();
    vi.stubGlobal("window", {
      nostr: {
        getPublicKey: () => signer.getPublicKey(),
        signEvent: (event: Parameters<typeof signer.signEvent>[0]) =>
          signer.signEvent(event),
      },
    });

    const { data, error } = await client.signIn.nostr();

    expect(error).toBeNull();
    expect(data?.user.name).toBe(npubOf(secretKey));
  });
});
