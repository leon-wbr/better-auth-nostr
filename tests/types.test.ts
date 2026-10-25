import { createAuthClient } from "better-auth/client";
import { describe, expectTypeOf, it } from "vitest";
import { nostrClient } from "../src/client";

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
});
