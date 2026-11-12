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
  DEFAULT_BASE_PATH,
  endpointURL,
  NOSTR_PATHS,
  type NostrPath,
} from "./endpoints";
import { NOSTR_ERROR_CODES, type NostrErrorCode } from "./error-codes";
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
import type { NostrPubkey, RelayOptions } from "./types";

type ActionError = {
  code: NostrErrorCode;
  message: string;
  status: number;
  statusText: string;
};

type ActionResult<T> =
  | { data: T; error: null }
  | { data: null; error: ActionError };

/**
 * Runs a client-side action and turns a thrown error into Better Auth's
 * `{ data, error }` shape, with status 400 "BAD_REQUEST" as Better Auth's
 * passkey client does for a failed ceremony. Responses `run` returns (such as
 * a `$fetch` result carrying the server's own status) pass through untouched.
 */
const asAction = async <R>(
  { code, message }: (typeof NOSTR_ERROR_CODES)[NostrErrorCode],
  run: () => Promise<R>,
): Promise<R | { data: null; error: ActionError }> => {
  try {
    return await run();
  } catch (err) {
    return {
      data: null,
      error: {
        code,
        message: err instanceof Error ? err.message : message,
        status: 400,
        statusText: "BAD_REQUEST",
      },
    };
  }
};

const ok = <T>(data: T): { data: T; error: null } => ({ data, error: null });

type AddPubkeyOptions = SignerSource & {
  /** Optional display label stored alongside the pubkey row. */
  name?: string;
};

/**
 * The URL the NIP-98 event is signed against has to match the one the server
 * validates against, which is `baseURL + basePath`. Deriving it from the
 * window origin alone drops the base path and every signature fails.
 */
const clientEndpointURL = (
  options: BetterAuthClientOptions | undefined,
  path: NostrPath,
) => {
  const baseURL =
    options?.baseURL ||
    (typeof window !== "undefined" ? window.location.origin : "");
  if (!baseURL) {
    throw new Error(
      "nostrClient: cannot determine absolute URL — set baseURL on the client",
    );
  }
  // Same composition as the server's `ctx.context.baseURL`.
  const base = endpointURL(baseURL, options?.basePath || DEFAULT_BASE_PATH);
  return endpointURL(base, path);
};

export const getNostrActions = (
  $fetch: BetterFetch,
  { $store }: { $store: ClientStore },
  options?: BetterAuthClientOptions,
  relayOptions: RelayOptions = {},
) => {
  const fetchNonce = async (publicKey: string): Promise<string> => {
    const { data, error } = await $fetch<{ nonce: string }>(NOSTR_PATHS.nonce, {
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
  const authorize = async (path: NostrPath, source?: SignerSource) => {
    const signer = resolveSigner(source);
    const publicKey = await signer.getPublicKey();
    const nonce = await fetchNonce(publicKey);
    const token = await mintToken(
      clientEndpointURL(options, path),
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
  ) =>
    asAction(NOSTR_ERROR_CODES.NOSTR_SIGN_IN_FAILED, async () => {
      const { nonce, token } = await authorize(
        NOSTR_PATHS.login,
        signInOptions,
      );

      const response = await $fetch<{
        session: { id: string; userId: string; expiresAt: Date };
        user: { id: string; email: string; name: string };
      }>(NOSTR_PATHS.login, {
        method: "POST",
        headers: { authorization: token },
        body: { nonce },
        ...fetchOptions,
      });

      if (!response.error) {
        $store.notify("$sessionSignal");
      }

      return response;
    });

  const addPubkey = (
    addOptions?: AddPubkeyOptions,
    fetchOptions?: BetterFetchOption,
  ) =>
    asAction(NOSTR_ERROR_CODES.NOSTR_ADD_PUBKEY_FAILED, async () => {
      const { nonce, token } = await authorize(
        NOSTR_PATHS.addPubkey,
        addOptions,
      );

      return await $fetch<{ pubkey: NostrPubkey }>(NOSTR_PATHS.addPubkey, {
        method: "POST",
        headers: { authorization: token },
        body: { nonce, name: addOptions?.name },
        ...fetchOptions,
      });
    });

  const signEvent = (
    template: EventTemplate,
    source?: SignerSource,
  ): Promise<ActionResult<NostrEvent>> =>
    asAction(NOSTR_ERROR_CODES.NOSTR_SIGN_EVENT_FAILED, async () => {
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
      return ok(signed);
    });

  /**
   * Fetch the kind 0 profile for an npub, nprofile, hex pubkey or NIP-05
   * identifier from the configured relays plus the input's own relay hints.
   * `data` is `null` when no relay has a profile.
   */
  const getProfile = (
    input: string,
    callOptions?: { timeoutMs?: number },
  ): Promise<ActionResult<NostrProfile | null>> =>
    asAction(NOSTR_ERROR_CODES.NOSTR_GET_PROFILE_FAILED, async () => {
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
      return ok(profile);
    });

  return {
    signIn: { nostr: signInNostr },
    nostr: { addPubkey, signEvent, getProfile },
    $Infer: {} as { Nostr: NostrPubkey },
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
      [NOSTR_PATHS.nonce]: "POST",
      [NOSTR_PATHS.login]: "POST",
      [NOSTR_PATHS.addPubkey]: "POST",
    },
    $ERROR_CODES: NOSTR_ERROR_CODES,
  } satisfies BetterAuthClientPlugin;
};

export { NOSTR_ERROR_CODES, type NostrErrorCode } from "./error-codes";

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
