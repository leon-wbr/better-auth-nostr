"use client";

import { useRouter } from "next/navigation";
import { generateSecretKey, nip19 } from "nostr-tools";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export function SignIn() {
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const [nsec, setNsec] = useState("");
  const [error, setError] = useState<string>();

  const signIn = async (source?: { nsec: string }) => {
    const { error } = await authClient.signIn.nostr(source);
    setError(error ? (error.message ?? error.code) : undefined);
    router.refresh();
  };

  if (session) {
    return (
      <p>
        Signed in as <code>{session.user.name}</code>{" "}
        <button
          type="button"
          onClick={async () => {
            await authClient.signOut();
            router.refresh();
          }}
        >
          Sign out
        </button>
      </p>
    );
  }

  return (
    <>
      <p>
        <button type="button" onClick={() => signIn()}>
          Sign in with a browser extension (NIP-07)
        </button>
      </p>
      <p>
        <input
          aria-label="nsec"
          placeholder="nsec1…"
          value={nsec}
          onChange={(event) => setNsec(event.target.value)}
          size={66}
        />{" "}
        <button
          type="button"
          onClick={() => setNsec(nip19.nsecEncode(generateSecretKey()))}
        >
          Generate
        </button>{" "}
        <button type="button" disabled={!nsec} onClick={() => signIn({ nsec })}>
          Sign in with nsec
        </button>
      </p>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
