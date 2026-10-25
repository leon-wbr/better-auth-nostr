import { finalizeEvent, nip19 } from "nostr-tools";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getNostrActions } from "../src/client";
import type { RelayOptions } from "../src/types";
import { createTestStore, makeKeypair, TEST_ORIGIN } from "./helpers";

const relay = vi.hoisted(() => ({
  calls: [] as { relays: string[]; params: any }[],
  event: null as unknown,
}));

vi.mock("nostr-tools/pool", () => ({
  SimplePool: class {
    async get(relays: string[], _filter: unknown, params: unknown) {
      relay.calls.push({ relays, params });
      return relay.event;
    }
    close() {}
  },
}));

beforeEach(() => {
  relay.calls = [];
  relay.event = null;
});

const actionsWith = (relayOptions?: RelayOptions) => {
  let serverCalls = 0;
  const $fetch = (async () => {
    serverCalls++;
    return { data: null, error: null };
  }) as any;
  const actions = getNostrActions(
    $fetch,
    createTestStore(),
    { baseURL: TEST_ORIGIN } as any,
    relayOptions,
  );
  return { actions, serverCalls: () => serverCalls };
};

describe("client getProfile", () => {
  it("fetches the profile from the configured relays without touching the server", async () => {
    const kp = makeKeypair();
    relay.event = finalizeEvent(
      { kind: 0, created_at: 1, tags: [], content: '{"name":"alice"}' },
      kp.secretKey,
    );
    const { actions, serverCalls } = actionsWith({
      relays: ["wss://relay.example.com"],
    });

    const result = await actions.nostr.getProfile(
      nip19.npubEncode(kp.publicKey),
    );

    expect(result.error).toBeNull();
    expect(result.data?.metadata.name).toBe("alice");
    expect(relay.calls[0]?.relays).toEqual(["wss://relay.example.com/"]);
    expect(serverCalls()).toBe(0);
  });

  it("uses relayTimeoutMs, overridable per call", async () => {
    const kp = makeKeypair();
    const { actions } = actionsWith({
      relays: ["wss://relay.example.com"],
      relayTimeoutMs: 2_000,
    });

    await actions.nostr.getProfile(kp.publicKey);
    await actions.nostr.getProfile(kp.publicKey, { timeoutMs: 300 });

    expect(relay.calls.map((c) => c.params)).toEqual([
      { maxWait: 2_000 },
      { maxWait: 300 },
    ]);
  });

  it("follows the relay hints in an nprofile", async () => {
    const kp = makeKeypair();
    const { actions } = actionsWith({ relays: ["wss://relay.example.com"] });

    await actions.nostr.getProfile(
      nip19.nprofileEncode({
        pubkey: kp.publicKey,
        relays: ["wss://hint.example"],
      }),
    );

    expect(relay.calls[0]?.relays).toEqual([
      "wss://hint.example/",
      "wss://relay.example.com/",
    ]);
  });

  it("returns null data, not an error, when no relay has a profile", async () => {
    const { actions } = actionsWith({ relays: ["wss://relay.example.com"] });
    const result = await actions.nostr.getProfile(makeKeypair().publicKey);
    expect(result).toEqual({ data: null, error: null });
  });

  it("reports an error when no relays are configured", async () => {
    const { actions } = actionsWith();
    const result = await actions.nostr.getProfile(makeKeypair().publicKey);

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("NOSTR_GET_PROFILE_FAILED");
    expect(result.error?.message).toMatch(/relays/);
    expect(relay.calls).toHaveLength(0);
  });

  it("reports an error instead of throwing on input it cannot interpret", async () => {
    const { actions } = actionsWith({ relays: ["wss://relay.example.com"] });
    const result = await actions.nostr.getProfile("nonsense");

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("NOSTR_GET_PROFILE_FAILED");
  });
});
