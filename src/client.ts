import type {
  BetterAuthClientOptions,
  BetterAuthClientPlugin,
  ClientStore,
} from "@better-auth/core";
import type { BetterFetch } from "@better-fetch/fetch";
import type { Session, User } from "better-auth";
import { finalizeEvent, nip19 } from "nostr-tools";
import { getToken } from "nostr-tools/nip98";
import { hexToBytes } from "nostr-tools/utils";
import type { nostr } from ".";
import type { Nostr } from "./types";

const getLoginUrl = (options?: BetterAuthClientOptions) => {
  const baseURL =
    options?.baseURL ||
    (typeof window !== "undefined" ? window.location.origin : "");
  const basePath = options?.basePath || "/api/auth";
  return `${baseURL}${basePath}/nostr/login`;
};

const parseSecretKey = (input: string) => {
  const trimmed = input.trim();
  if (trimmed === "") {
    throw new Error("Missing NSEC private key");
  }

  const candidate = trimmed.toLowerCase();

  if (nip19.NostrTypeGuard.isNSec(candidate)) {
    const decoded = nip19.decode(candidate);
    if (decoded.type !== "nsec") {
      throw new Error("Invalid NSEC private key");
    }

    return decoded.data;
  }

  if (/^[a-f0-9]{64}$/i.test(trimmed)) {
    return hexToBytes(trimmed);
  }

  throw new Error("Invalid NSEC private key");
};

export const getNostrActions = (
  $fetch: BetterFetch,
  {
    $store,
  }: {
    $store: ClientStore;
  },
  options?: BetterAuthClientOptions
) => {
  const loginUrl = getLoginUrl(options);

  const fetchNonce = async () => {
    const { data } = await $fetch<{ nonce: string }>("/nostr/nonce", {
      method: "GET",
    });
    const nonce = data?.nonce;
    if (!nonce) {
      throw new Error("Failed to fetch nonce");
    }
    return nonce;
  };

  const getTokenWithNsec = async (
    nsec: string,
    payload: Record<string, unknown>
  ) => {
    const secretKey = parseSecretKey(nsec);
    return getToken(
      loginUrl,
      "post",
      (event) => finalizeEvent(event, secretKey),
      true,
      payload
    );
  };

  const getTokenWithExtension = async (payload: Record<string, unknown>) => {
    if (!("nostr" in window)) {
      throw new Error("Nostr extension not found");
    }

    const sign = (window.nostr as any).signEvent.bind(window.nostr);
    return getToken(loginUrl, "post", (e) => sign(e), true, payload);
  };

  const signInNostr = async (options?: { nsec?: string }) => {
    const nonce = await fetchNonce();
    const payload = { nonce };
    const token = options?.nsec
      ? await getTokenWithNsec(options.nsec, payload)
      : await getTokenWithExtension(payload);

    try {
      const response = await $fetch<{
        session: Session;
        user: User;
      }>("/nostr/login", {
        method: "POST",
        headers: {
          authorization: token,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          nonce,
        }),
      });

      $store.notify("$sessionSignal");

      return response;
    } catch {
      return {
        data: null,
        error: {
          code: "AUTH_CANCELLED",
          message: "auth cancelled",
          status: 400,
          statusText: "BAD_REQUEST",
        },
      };
    }
  };

  // const addPubkey = async () => {
  //   // Register a new pubkey for a user
  // };

  return {
    signIn: {
      nostr: signInNostr,
    },
    // nostr: {
    //   addPubkey,
    // },
    $Infer: {} as {
      Nostr: Nostr;
    },
  };
};

export const nostrClient = () => {
  return {
    id: "nostr",
    $InferServerPlugin: {} as ReturnType<typeof nostr>,
    getActions: ($fetch, $store, options) =>
      getNostrActions($fetch, { $store }, options),
    pathMethods: {
      "/nostr/nonce": "GET",
      "/nostr/login": "POST",
      "/nostr/add-pubkey": "POST",
    },
  } satisfies BetterAuthClientPlugin;
};

export type * from "./types";
