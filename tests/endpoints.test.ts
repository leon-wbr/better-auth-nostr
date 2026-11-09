import { nip19 } from "nostr-tools";
import { unpackEventFromToken } from "nostr-tools/nip98";
import { describe, expect, it } from "vitest";
import { getNostrActions } from "../src/client";
import { endpointURL, NOSTR_PATHS } from "../src/endpoints";
import {
  createTestAuth,
  createTestFetch,
  createTestStore,
  makeKeypair,
  TEST_BASE_URL,
  TEST_ORIGIN,
} from "./helpers";

describe("endpointURL", () => {
  it("joins base and path with exactly one slash", () => {
    expect(endpointURL("http://x/api/auth", "/nostr/login")).toBe(
      "http://x/api/auth/nostr/login",
    );
    expect(endpointURL("http://x/api/auth/", "/nostr/login")).toBe(
      "http://x/api/auth/nostr/login",
    );
    expect(endpointURL("http://x/api/auth", "nostr/login")).toBe(
      "http://x/api/auth/nostr/login",
    );
  });

  it.each([
    ["without a trailing slash", TEST_ORIGIN],
    ["with a trailing slash", `${TEST_ORIGIN}/`],
  ])("client signs the URL the server computes, %s", async (_name, baseURL) => {
    const auth = createTestAuth();
    const keypair = makeKeypair();
    const { $store } = createTestStore();
    const $fetch = createTestFetch(auth);

    const signed: string[] = [];
    const spyFetch = (async (path: string, init?: any) => {
      if (init?.headers?.authorization) {
        const event = await unpackEventFromToken(init.headers.authorization);
        signed.push(event.tags.find((t) => t[0] === "u")![1]!);
      }
      return ($fetch as any)(path, init);
    }) as any;

    const actions = getNostrActions(spyFetch, { $store }, { baseURL } as any);
    const result = await actions.signIn.nostr({
      nsec: nip19.nsecEncode(keypair.secretKey),
    });

    // The server only accepts the token when its own URL matches byte for byte.
    expect(result.error).toBeNull();
    expect(signed).toEqual([endpointURL(TEST_BASE_URL, NOSTR_PATHS.login)]);
    expect(signed).toEqual([`${TEST_BASE_URL}/nostr/login`]);
  });
});
