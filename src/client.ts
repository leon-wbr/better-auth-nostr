import type {
  BetterAuthClientOptions,
  BetterAuthClientPlugin,
  ClientStore,
} from "@better-auth/core";
import type { BetterFetch, BetterFetchOption } from "@better-fetch/fetch";
import type { EventTemplate, Event as NostrEvent } from "nostr-tools";
import { verifyEvent } from "nostr-tools";
import { getToken } from "nostr-tools/nip98";
import type { nostr } from ".";
import {
  DEFAULT_RELAY_TIMEOUT_MS,
  fetchProfile,
  type NostrProfile,
} from "./profile";
import {
  assertFreshlySigned,
  DEFAULT_SIGNER_TIMEOUT_MS,
  type NostrSigner,
  resolveSigner,
  type SignerSource,
  withTimeout,
} from "./signer";
import type { Nostr, RelayOptions } from "./types";

type ActionError = {
  code: string;
  message: string;
  status: number;
  statusText: string;
};

const actionError = (
  code: string,
  err: unknown,
  fallback: string,
): ActionError => ({
  code,
  message: err instanceof Error ? err.message : fallback,
  status: 400,
  statusText: "BAD_REQUEST",
});

type AddPubkeyOptions = SignerSource & {
  /** Optional display label stored alongside the pubkey row. */
  name?: string;
};

/**
 * The URL the NIP-98 event is signed against has to match the one the server
 * validates against, which is `baseURL + basePath`. Deriving it from the
 * window origin alone drops the base path and every signature fails.
 */
const getEndpointUrl = (
  options: BetterAuthClientOptions | undefined,
  path: string,
) => {
  const baseURL =
    options?.baseURL ||
    (typeof window !== "undefined" ? window.location.origin : "");
  if (!baseURL) {
    throw new Error(
      "nostrClient: cannot determine absolute URL — set baseURL on the client",
    );
  }
  const basePath = options?.basePath || "/api/auth";
  const trimmed = baseURL.endsWith("/") ? baseURL.slice(0, -1) : baseURL;
  return `${trimmed}${basePath}${path}`;
};

export const getNostrActions = (
  $fetch: BetterFetch,
  { $store }: { $store: ClientStore },
  options?: BetterAuthClientOptions,
  relayOptions: RelayOptions = {},
) => {
  const fetchNonce = async (publicKey: string): Promise<string> => {
    const { data, error } = await $fetch<{ nonce: string }>("/nostr/nonce", {
      method: "POST",
      body: { publicKey },
    });
    if (error || !data?.nonce) {
      throw new Error(error?.message ?? "Failed to fetch nonce");
    }
    return data.nonce;
  };

  const mintToken = async (
    url: string,
    signer: NostrSigner,
    publicKey: string,
    payload: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<string> =>
    getToken(
      url,
      "post",
      async (event) => {
        const signed = await withTimeout(
          signer.signEvent(event),
          timeoutMs,
          "The signer did not respond in time",
        );
        // A signer that switched accounts mid-flow would otherwise fail later
        // as "invalid or expired nonce", pointing at the wrong problem.
        if (signed.pubkey !== publicKey) {
          throw new Error(
            "The signer signed with a different key than it reported — sign in again",
          );
        }
        return assertFreshlySigned(signed);
      },
      true,
      payload,
    );

  /** Fetch a nonce for the signer's key and mint a NIP-98 token against it. */
  const authorize = async (path: string, source?: SignerSource) => {
    const signer = resolveSigner(source);
    const publicKey = await signer.getPublicKey();
    const nonce = await fetchNonce(publicKey);
    const token = await mintToken(
      getEndpointUrl(options, path),
      signer,
      publicKey,
      { nonce },
      source?.timeoutMs ?? DEFAULT_SIGNER_TIMEOUT_MS,
    );
    return { nonce, token };
  };

  const signInNostr = async (
    signInOptions?: SignerSource,
    fetchOptions?: BetterFetchOption,
  ) => {
    try {
      const { nonce, token } = await authorize("/nostr/login", signInOptions);

      const response = await $fetch<{
        session: { id: string; userId: string; expiresAt: Date };
        user: { id: string; email: string; name: string };
      }>("/nostr/login", {
        method: "POST",
        headers: { authorization: token },
        body: { nonce },
        ...fetchOptions,
      });

      if (!response.error) {
        $store.notify("$sessionSignal");
      }

      return response;
    } catch (err) {
      return {
        data: null,
        error: actionError("NOSTR_SIGN_IN_FAILED", err, "Nostr sign-in failed"),
      };
    }
  };

  const addPubkey = async (
    addOptions?: AddPubkeyOptions,
    fetchOptions?: BetterFetchOption,
  ) => {
    try {
      const { nonce, token } = await authorize("/nostr/add-pubkey", addOptions);

      return await $fetch<{ pubkey: Nostr }>("/nostr/add-pubkey", {
        method: "POST",
        headers: { authorization: token },
        body: { nonce, name: addOptions?.name },
        ...fetchOptions,
      });
    } catch (err) {
      return {
        data: null,
        error: actionError(
          "NOSTR_ADD_PUBKEY_FAILED",
          err,
          "Failed to add pubkey",
        ),
      };
    }
  };

  const signEvent = async (
    template: EventTemplate,
    source?: SignerSource,
  ): Promise<
    { data: NostrEvent; error: null } | { data: null; error: ActionError }
  > => {
    try {
      const signer = resolveSigner(source);
      const signed = await withTimeout(
        (async () => {
          const publicKey = await signer.getPublicKey();
          return { publicKey, event: await signer.signEvent(template) };
        })(),
        source?.timeoutMs ?? DEFAULT_SIGNER_TIMEOUT_MS,
        "The signer did not respond in time",
      ).then(({ publicKey, event }) => {
        if (event.pubkey !== publicKey) {
          throw new Error(
            "The signer signed with a different key than it reported",
          );
        }
        // Rebuilt from protocol fields so nostr-tools' cached verification
        // flag on the signer's object cannot vouch for mutated content.
        const fresh: NostrEvent = {
          id: event.id,
          pubkey: event.pubkey,
          created_at: event.created_at,
          kind: event.kind,
          tags: event.tags,
          content: event.content,
          sig: event.sig,
        };
        if (!verifyEvent(fresh)) {
          throw new Error("The signer returned an invalid event");
        }
        return fresh;
      });
      return { data: signed, error: null };
    } catch (err) {
      return {
        data: null,
        error: actionError(
          "NOSTR_SIGN_EVENT_FAILED",
          err,
          "Failed to sign event",
        ),
      };
    }
  };

  /**
   * Fetch the kind 0 profile for an npub, nprofile, hex pubkey or NIP-05
   * identifier from the configured relays plus the input's own relay hints.
   * `data` is `null` when no relay has a profile.
   */
  const getProfile = async (
    input: string,
    callOptions?: { timeoutMs?: number },
  ): Promise<
    | { data: NostrProfile | null; error: null }
    | { data: null; error: ActionError }
  > => {
    try {
      if (!relayOptions.relays?.length) {
        throw new Error("getProfile needs nostrClient({ relays })");
      }
      const profile = await fetchProfile(input, {
        relays: relayOptions.relays,
        timeoutMs:
          callOptions?.timeoutMs ??
          relayOptions.relayTimeoutMs ??
          DEFAULT_RELAY_TIMEOUT_MS,
        followRelayHints: true,
      });
      return { data: profile, error: null };
    } catch (err) {
      return {
        data: null,
        error: actionError(
          "NOSTR_GET_PROFILE_FAILED",
          err,
          "Failed to fetch profile",
        ),
      };
    }
  };

  return {
    signIn: { nostr: signInNostr },
    nostr: { addPubkey, signEvent, getProfile },
    $Infer: {} as { Nostr: Nostr },
  };
};

type NostrActions = ReturnType<typeof getNostrActions>;

/** `nostr.getProfile` only exists once `relays` is configured. */
type NostrClientActions<O extends RelayOptions> = O extends {
  relays: [string, ...string[]];
}
  ? NostrActions
  : Omit<NostrActions, "nostr"> & {
      nostr: Omit<NostrActions["nostr"], "getProfile">;
    };

export const nostrClient = <O extends RelayOptions = RelayOptions>(
  relayOptions?: O,
) => {
  return {
    id: "nostr",
    $InferServerPlugin: {} as ReturnType<typeof nostr>,
    getActions: ($fetch, $store, options): NostrClientActions<O> =>
      getNostrActions($fetch, { $store }, options, relayOptions),
    pathMethods: {
      "/nostr/nonce": "POST",
      "/nostr/login": "POST",
      "/nostr/add-pubkey": "POST",
    },
  } satisfies BetterAuthClientPlugin;
};

export type { NostrProfile, NostrProfileMetadata } from "./profile";
export type {
  BunkerSignerOptions,
  NostrConnectOptions,
  NostrConnectSession,
  NostrSigner,
  RemoteNostrSigner,
  SignerSource,
} from "./signer";
export {
  createBunkerSigner,
  createExtensionSigner,
  createNostrConnectSession,
  createPrivateKeySigner,
  parseSecretKey,
} from "./signer";
export type * from "./types";
