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
  resolveSigner,
  type SignerSource,
} from "./signer";
import type { Nostr, NostrSigner } from "./types";

type SignInOptions = SignerSource;

type AddPubkeyOptions = SignInOptions & {
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
    payload: Record<string, unknown>,
  ): Promise<string> =>
    getToken(
      url,
      "post",
      async (event) => assertFreshlySigned(await signer.signEvent(event)),
      true,
      payload,
    );

  const signInNostr = async (
    signInOptions?: SignInOptions,
    fetchOptions?: BetterFetchOption,
  ) => {
    try {
      const signer = resolveSigner(signInOptions);
      const publicKey = await signer.getPublicKey();
      const nonce = await fetchNonce(publicKey);
      const url = getEndpointUrl(options, "/nostr/login");
      const token = await mintToken(url, signer, { nonce });

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
      const signer = resolveSigner(addOptions);
      const publicKey = await signer.getPublicKey();
      const nonce = await fetchNonce(publicKey);
      const url = getEndpointUrl(options, "/nostr/add-pubkey");
      const token = await mintToken(url, signer, { nonce });

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
  SignerSource,
} from "./signer";
export {
  createBunkerSigner,
  createExtensionSigner,
  createNostrConnectSession,
  createPrivateKeySigner,
  parseSecretKey,
  resolveSigner,
} from "./signer";
export type * from "./types";
