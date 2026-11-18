import { betterAuth } from "better-auth";
import { createAuthClient } from "better-auth/client";
import { generateSecretKey, getPublicKey, nip19 } from "nostr-tools";
import { nostrClient } from "../dist/client.mjs";
import { nostr } from "../dist/index.mjs";

const BASE_URL = "http://localhost:3000";

/**
 * A full sign-in against the built package, client and server in one
 * process: nonce, NIP-98 login, then the session the cookie carries. No
 * `database`, so Better Auth uses its built-in memory adapter.
 */
export const signIn = async () => {
  const auth = betterAuth({
    baseURL: BASE_URL,
    secret: "smoke-test-secret-not-for-production",
    plugins: [nostr()],
  });

  let cookie = "";
  const client = createAuthClient({
    baseURL: BASE_URL,
    plugins: [nostrClient()],
    fetchOptions: {
      customFetchImpl: async (input, init) => {
        const request = new Request(input, init);
        if (cookie) request.headers.set("cookie", cookie);
        const response = await auth.handler(request);
        const set = response.headers.getSetCookie();
        if (set.length) cookie = set.map((c) => c.split(";")[0]).join("; ");
        return response;
      },
    },
  });

  const secretKey = generateSecretKey();
  const { error } = await client.signIn.nostr({
    nsec: nip19.nsecEncode(secretKey),
  });
  if (error) throw new Error(`sign-in failed: ${JSON.stringify(error)}`);

  const session = await client.getSession();
  const npub = nip19.npubEncode(getPublicKey(secretKey));
  if (session.data?.user.name !== npub) {
    throw new Error(`no session after sign-in: ${JSON.stringify(session)}`);
  }
  return npub;
};

export default {
  async fetch() {
    try {
      return new Response(`signed in as ${await signIn()}`);
    } catch (error) {
      return new Response(String(error), { status: 500 });
    }
  },
};
