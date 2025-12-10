import { createAuthClient } from "better-auth/react";
import { nostrClient } from "better-auth-nostr/client";

export const authClient = createAuthClient({
  plugins: [nostrClient()],
});
