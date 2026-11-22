import { createAuthClient } from "better-auth/client";
import { generateSecretKey, getPublicKey, nip19 } from "nostr-tools";
import { nostrClient } from "../dist/client.mjs";

/**
 * Signs in with a fresh nsec against a running example over HTTP, then reads
 * the session back with the cookie it set. `node smoke/http.ts <origin>`.
 */
const origin = process.argv[2] ?? "http://localhost:3000";
const cookies = new Map<string, string>();

const client = createAuthClient({
  baseURL: origin,
  plugins: [nostrClient()],
  fetchOptions: {
    customFetchImpl: async (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set("origin", origin);
      if (cookies.size) {
        headers.set(
          "cookie",
          [...cookies].map(([name, value]) => `${name}=${value}`).join("; "),
        );
      }
      const response = await fetch(input, { ...init, headers });
      for (const cookie of response.headers.getSetCookie()) {
        const [pair = ""] = cookie.split(";", 1);
        const index = pair.indexOf("=");
        cookies.set(pair.slice(0, index), pair.slice(index + 1));
      }
      return response;
    },
  },
});

const secretKey = generateSecretKey();
const npub = nip19.npubEncode(getPublicKey(secretKey));

const { error } = await client.signIn.nostr({
  nsec: nip19.nsecEncode(secretKey),
});
if (error) throw new Error(`sign-in failed: ${JSON.stringify(error)}`);

const session = await client.getSession();
if (session.data?.user.name !== npub) {
  throw new Error(`no session after sign-in: ${JSON.stringify(session)}`);
}
console.log(`signed in at ${origin} as ${npub}`);
