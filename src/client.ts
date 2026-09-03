import type {
  BetterAuthClientOptions,
  BetterAuthClientPlugin,
  ClientStore,
} from "@better-auth/core";
import type { BetterFetch, BetterFetchOption } from "@better-fetch/fetch";
import {
  getPublicKey as derivePublicKey,
  type EventTemplate,
  finalizeEvent,
  type Event as NostrEvent,
  nip19,
} from "nostr-tools";
import { getToken } from "nostr-tools/nip98";
import { hexToBytes } from "nostr-tools/utils";
import type { nostr } from ".";
import type { Nostr } from "./types";

type SignInOptions = {
  /** Bech32 nsec or 64-char hex secret. Omit to use a NIP-07 extension. */
  nsec?: string;
};

type AddPubkeyOptions = SignInOptions & {
  /** Optional display label stored alongside the pubkey row. */
  name?: string;
};

type WindowNostr = {
  getPublicKey: () => Promise<string> | string;
  signEvent: (event: EventTemplate) => Promise<NostrEvent> | NostrEvent;
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

const getExtension = (): WindowNostr | null => {
  if (typeof window === "undefined") return null;
  const ext = (window as unknown as { nostr?: WindowNostr }).nostr;
  return ext && typeof ext.signEvent === "function" ? ext : null;
};

export const parseSecretKey = (input: string): Uint8Array => {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Missing NSEC private key");

  const lower = trimmed.toLowerCase();
  if (nip19.NostrTypeGuard.isNSec(lower)) {
    const decoded = nip19.decode(lower);
    if (decoded.type !== "nsec") {
      throw new Error("Invalid NSEC private key");
    }
    return decoded.data;
  }

  if (/^[a-f0-9]{64}$/i.test(trimmed)) {
    return hexToBytes(trimmed.toLowerCase());
  }

  throw new Error("Invalid NSEC private key");
};

const resolvePublicKey = async (nsec?: string): Promise<string> => {
  if (nsec) return derivePublicKey(parseSecretKey(nsec));
  const ext = getExtension();
  if (!ext) throw new Error("No NIP-07 extension and no NSEC provided");
  return await ext.getPublicKey();
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
    nsec: string | undefined,
    payload: Record<string, unknown>,
  ): Promise<string> => {
    if (nsec) {
      const secretKey = parseSecretKey(nsec);
      return getToken(
        url,
        "post",
        (event) => finalizeEvent(event, secretKey),
        true,
        payload,
      );
    }
    const ext = getExtension();
    if (!ext) throw new Error("Nostr NIP-07 extension not found");
    return getToken(
      url,
      "post",
      (event) => Promise.resolve(ext.signEvent(event)),
      true,
      payload,
    );
  };

  const signInNostr = async (
    signInOptions?: SignInOptions,
    fetchOptions?: BetterFetchOption,
  ) => {
    try {
      const publicKey = await resolvePublicKey(signInOptions?.nsec);
      const nonce = await fetchNonce(publicKey);
      const url = getEndpointUrl(options, "/nostr/login");
      const token = await mintToken(url, signInOptions?.nsec, { nonce });

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
      const publicKey = await resolvePublicKey(addOptions?.nsec);
      const nonce = await fetchNonce(publicKey);
      const url = getEndpointUrl(options, "/nostr/add-pubkey");
      const token = await mintToken(url, addOptions?.nsec, { nonce });

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

export type * from "./types";
