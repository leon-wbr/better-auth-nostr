import { createAuthClient } from "better-auth/client";
import { describe, expectTypeOf, it } from "vitest";
import { nostrClient } from "../src/client";
import { nostr } from "../src/index";
import type { NostrMappedUser } from "../src/types";

describe("relay options at the type level", () => {
  it("exposes nostr.getProfile only when relays are configured", () => {
    const withRelays = createAuthClient({
      baseURL: "http://localhost:3000",
      plugins: [nostrClient({ relays: ["wss://relay.example.com"] })],
    });
    expectTypeOf(withRelays.nostr.getProfile).toBeFunction();

    const withoutRelays = createAuthClient({
      baseURL: "http://localhost:3000",
      plugins: [nostrClient()],
    });
    expectTypeOf(withoutRelays.nostr.signEvent).toBeFunction();
    // @ts-expect-error getProfile needs nostrClient({ relays })
    withoutRelays.nostr.getProfile;
  });

  it("rejects an empty relay list", () => {
    // @ts-expect-error relays must name at least one relay
    nostrClient({ relays: [] });
  });

  it("requires relays when fetchProfileOnSignIn is on", () => {
    nostr({ relays: ["wss://relay.example.com"], fetchProfileOnSignIn: true });
    nostr({ fetchProfileOnSignIn: false });
    // @ts-expect-error fetchProfileOnSignIn needs relays
    nostr({ fetchProfileOnSignIn: true });
  });

  it("keeps identity and email out of mapProfileToUser", () => {
    expectTypeOf<NostrMappedUser["email"]>().toEqualTypeOf<undefined>();
    expectTypeOf<NostrMappedUser["emailVerified"]>().toEqualTypeOf<undefined>();
    expectTypeOf<NostrMappedUser["id"]>().toEqualTypeOf<undefined>();
    nostr({
      relays: ["wss://relay.example.com"],
      fetchProfileOnSignIn: true,
      // @ts-expect-error email cannot be mapped from a kind 0 profile
      mapProfileToUser: () => ({ email: "alice@example.com" }),
    });
  });
});
