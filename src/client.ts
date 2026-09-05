import type {
  BetterAuthClientOptions,
  BetterAuthClientPlugin,
  ClientStore,
} from "@better-auth/core";
import type { BetterFetch, BetterFetchOption } from "@better-fetch/fetch";
import { getToken } from "nostr-tools/nip98";
import type { nostr } from ".";
import {
  assertFreshlySigned,
  DEFAULT_SIGNER_TIMEOUT_MS,
  type NostrSigner,
  resolveSigner,
  type SignerSource,
  withTimeout,
} from "./signer";
import type { Nostr } from "./types";

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
        error: {
          code: "NOSTR_SIGN_IN_FAILED",
          message: err instanceof Error ? err.message : "Nostr sign-in failed",
          status: 400,
          statusText: "BAD_REQUEST",
        },
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
        error: {
          code: "NOSTR_ADD_PUBKEY_FAILED",
          message: err instanceof Error ? err.message : "Failed to add pubkey",
          status: 400,
          statusText: "BAD_REQUEST",
        },
      };
    }
  };

  return {
    signIn: { nostr: signInNostr },
    nostr: { addPubkey },
    $Infer: {} as { Nostr: Nostr },
  };
};

export const nostrClient = () => {
  return {
    id: "nostr",
    $InferServerPlugin: {} as ReturnType<typeof nostr>,
    getActions: ($fetch, $store, options) =>
      getNostrActions($fetch, { $store }, options),
    pathMethods: {
      "/nostr/nonce": "POST",
      "/nostr/login": "POST",
      "/nostr/add-pubkey": "POST",
    },
  } satisfies BetterAuthClientPlugin;
};

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
