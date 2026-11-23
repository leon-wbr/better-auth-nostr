/**
 * The client plugin and signers, imported from `better-auth-nostr/client`.
 * @module better-auth-nostr/client
 */
import type {
  BetterAuthClientOptions,
  BetterAuthClientPlugin,
  ClientStore,
} from "@better-auth/core";
import type { BetterFetch, BetterFetchOption } from "@better-fetch/fetch";
import type { Session, User } from "better-auth";
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
import {
  NOSTR_ERROR_CODES,
  NostrClientError,
  type NostrErrorCode,
} from "./error-codes";
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
 * Better Auth's `{ data, error }` shape for a client-side failure: 400
 * "BAD_REQUEST" as the passkey client reports a failed ceremony, 408 for a
 * signer timeout.
 */
const clientError = (err: unknown): { data: null; error: ActionError } => {
  const code =
    err instanceof NostrClientError ? err.code : "NOSTR_UNKNOWN_ERROR";
  const timeout = code === "NOSTR_SIGNER_TIMEOUT";
  return {
    data: null,
    error: {
      code,
      message:
        err instanceof Error ? err.message : NOSTR_ERROR_CODES[code].message,
      status: timeout ? 408 : 400,
      statusText: timeout ? "REQUEST_TIMEOUT" : "BAD_REQUEST",
    },
  };
};

type ServerError = { code?: string; message?: string };

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

/**
 * Signs with a timeout and rejects an event from a different key than
 * `expectedPubkey` or whose signature does not verify. Both `signEvent` and the
 * NIP-98 sign-in path go through here.
 */
const signVerified = async (
  signer: NostrSigner,
  template: EventTemplate,
  expectedPubkey: string,
  timeoutMs: number,
  keyMismatchHint = "",
): Promise<NostrEvent> => {
  const event = await withTimeout(signer.signEvent(template), timeoutMs);
  if (event.pubkey !== expectedPubkey) {
    throw new NostrClientError(
      NOSTR_ERROR_CODES.NOSTR_SIGNER_KEY_MISMATCH,
      `${NOSTR_ERROR_CODES.NOSTR_SIGNER_KEY_MISMATCH.message}${keyMismatchHint}`,
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
    throw new NostrClientError(NOSTR_ERROR_CODES.NOSTR_SIGNER_INVALID_EVENT);
  }
  return fresh;
};

/** Builds the actions `nostrClient` installs; for wiring them into a custom client. */
export const getNostrActions = (
  $fetch: BetterFetch,
  { $store }: { $store: ClientStore },
  options?: BetterAuthClientOptions,
  relayOptions: RelayOptions = {},
) => {
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
        // A signer that switched accounts mid-flow would otherwise fail later
        // as "invalid or expired nonce", pointing at the wrong problem.
        const signed = await signVerified(
          signer,
          event,
          publicKey,
          timeoutMs,
          " — sign in again",
        );
        return assertFreshlySigned(signed);
      },
      true,
      payload,
    );

  /**
   * Fetch a nonce for the signer's key and mint a NIP-98 token against it. A
   * server error from the nonce request comes back as is.
   */
  const authorize = async (path: NostrPath, source?: SignerSource) => {
    try {
      const signer = resolveSigner(source);
      const publicKey = await signer.getPublicKey();
      const response = await $fetch<{ nonce: string }, ServerError>(
        NOSTR_PATHS.nonce,
        { method: "POST", body: { publicKey }, throw: false },
      );
      if (response.error) return response;
      const { nonce } = response.data;
      const token = await mintToken(
        clientEndpointURL(options, path),
        signer,
        publicKey,
        { nonce },
        source?.timeoutMs ?? DEFAULT_SIGNER_TIMEOUT_MS,
      );
      return ok({ nonce, token });
    } catch (err) {
      return clientError(err);
    }
  };

  const signInNostr = async (
    signInOptions?: SignerSource,
    fetchOptions?: BetterFetchOption,
  ) => {
    const authorized = await authorize(NOSTR_PATHS.login, signInOptions);
    if (authorized.error) return authorized;

    const response = await $fetch<
      { session: Session; user: User },
      ServerError
    >(NOSTR_PATHS.login, {
      method: "POST",
      headers: { authorization: authorized.data.token },
      body: { nonce: authorized.data.nonce },
      ...fetchOptions,
    });

    if (!response.error) {
      $store.notify("$sessionSignal");
    }

    return response;
  };

  const addPubkey = async (
    addOptions?: AddPubkeyOptions,
    fetchOptions?: BetterFetchOption,
  ) => {
    const authorized = await authorize(NOSTR_PATHS.addPubkey, addOptions);
    if (authorized.error) return authorized;

    return await $fetch<{ pubkey: NostrPubkey }, ServerError>(
      NOSTR_PATHS.addPubkey,
      {
        method: "POST",
        headers: { authorization: authorized.data.token },
        body: { nonce: authorized.data.nonce, name: addOptions?.name },
        ...fetchOptions,
      },
    );
  };

  const signEvent = async (
    template: EventTemplate,
    source?: SignerSource,
  ): Promise<ActionResult<NostrEvent>> => {
    try {
      const signer = resolveSigner(source);
      const timeoutMs = source?.timeoutMs ?? DEFAULT_SIGNER_TIMEOUT_MS;
      const publicKey = await withTimeout(signer.getPublicKey(), timeoutMs);
      return ok(await signVerified(signer, template, publicKey, timeoutMs));
    } catch (err) {
      return clientError(err);
    }
  };

  /**
   * Fetch the kind 0 profile for an npub, nprofile, hex pubkey or NIP-05
   * identifier from the configured relays plus the input's own relay hints.
   * `data` is `null` when no relay has a profile.
   */
  const getProfile = async (
    input: string,
    callOptions?: {
      /** Overrides `relayTimeoutMs` for this call. */
      timeoutMs?: number;
    },
  ): Promise<ActionResult<NostrProfile | null>> => {
    try {
      if (!relayOptions.relays?.length) {
        throw new NostrClientError(
          NOSTR_ERROR_CODES.NOSTR_RELAYS_NOT_CONFIGURED,
        );
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
    } catch (err) {
      return clientError(err);
    }
  };

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

type NostrServerPlugin = ReturnType<typeof nostr>;

/** The client's own `signIn.nostr` takes a signer, so the endpoint's body-shaped route stays out of its types. */
type InferredServerPlugin = Omit<NostrServerPlugin, "endpoints"> & {
  endpoints: Omit<NostrServerPlugin["endpoints"], "signInNostr">;
};

/** The client plugin. Its options are `RelayOptions`. */
export const nostrClient = <O extends RelayOptions = RelayOptions>(
  relayOptions?: O,
) => {
  return {
    id: "nostr",
    /** @hidden */
    $InferServerPlugin: {} as InferredServerPlugin,
    /** @hidden */
    getActions: ($fetch, $store, options): NostrClientActions<O> =>
      getNostrActions($fetch, { $store }, options, relayOptions),
    /** @hidden */
    pathMethods: {
      [NOSTR_PATHS.nonce]: "POST",
      [NOSTR_PATHS.login]: "POST",
      [NOSTR_PATHS.legacyLogin]: "POST",
      [NOSTR_PATHS.addPubkey]: "POST",
      [NOSTR_PATHS.listPubkeys]: "GET",
      [NOSTR_PATHS.updatePubkey]: "POST",
      [NOSTR_PATHS.removePubkey]: "POST",
    },
    /** @hidden */
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
