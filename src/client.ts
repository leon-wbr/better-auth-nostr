import type { BetterAuthClientPlugin, ClientStore } from "@better-auth/core";
import type { BetterFetch } from "@better-fetch/fetch";
import type { Session, User } from "better-auth";
import { getToken } from "nostr-tools/nip98";
import type { nostr } from ".";
import type { Nostr } from "./types";

export const getNostrActions = (
  $fetch: BetterFetch,
  {
    $store,
  }: {
    $store: ClientStore;
  }
) => {
  const signInNostr = async () => {
    if (!("nostr" in window)) {
      throw new Error("Nostr extension not found");
    }

    const sign = (window.nostr as any).signEvent.bind(window.nostr);
    const token = await getToken(
      "http://testurl.com",
      "post",
      (e) => sign(e),
      true
    );

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
    getActions: ($fetch, $store) => getNostrActions($fetch, { $store }),
    pathMethods: {
      "/nostr/login": "POST",
      "/nostr/add-pubkey": "POST",
    },
  } satisfies BetterAuthClientPlugin;
};

export type * from "./types";
