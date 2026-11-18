import { isProduction } from "@better-auth/core/env";
import { BetterAuthError, type BetterAuthPlugin } from "better-auth";
import { NOSTR_PATHS } from "./endpoints";
import { NOSTR_ERROR_CODES } from "./error-codes";
import {
  addPubkey,
  getNostrNonce,
  listPubkeys,
  loginNostr,
  removePubkey,
  removePubkeysOfAccount,
  updatePubkey,
} from "./routes";
import type { NostrOptions } from "./types";

const DEFAULT_RATE_LIMITS = {
  nonce: { window: 60, max: 10 },
  login: { window: 10, max: 3 },
  addPubkey: { window: 60, max: 5 },
};

const MISSING_BASE_URL =
  "NIP-98 signatures are checked against the server's URL, and no baseURL is configured, so it is derived from the request's Host header. Set baseURL or BETTER_AUTH_URL, or pass allowDynamicBaseURL: true to the nostr plugin to accept that.";

export const nostr = (options?: NostrOptions) => {
  return {
    id: "nostr",
    init(ctx) {
      if (!ctx.options.baseURL && !options?.allowDynamicBaseURL) {
        if (isProduction) throw new BetterAuthError(MISSING_BASE_URL);
        ctx.logger.warn(`[better-auth-nostr] ${MISSING_BASE_URL}`);
      }
      return {
        options: {
          databaseHooks: {
            account: {
              delete: {
                after: (account) =>
                  removePubkeysOfAccount(ctx.adapter, account),
              },
            },
          },
        },
      };
    },
    endpoints: {
      getNostrNonce: getNostrNonce(options),
      loginNostr: loginNostr(options),
      addPubkey: addPubkey(options),
      listPubkeys: listPubkeys(options),
      updatePubkey: updatePubkey(options),
      removePubkey: removePubkey(options),
    },
    schema: {
      nostrPubkey: {
        modelName: options?.modelName ?? "nostrPubkey",
        fields: {
          name: {
            type: "string",
            required: false,
            fieldName: options?.fields?.name ?? "name",
          },
          publicKey: {
            type: "string",
            required: true,
            unique: true,
            index: true,
            fieldName: options?.fields?.publicKey ?? "publicKey",
          },
          userId: {
            type: "string",
            required: true,
            references: { model: "user", field: "id", onDelete: "cascade" },
            index: true,
            fieldName: options?.fields?.userId ?? "userId",
          },
          createdAt: {
            type: "date",
            required: true,
            fieldName: options?.fields?.createdAt ?? "createdAt",
          },
          lastUsedAt: {
            type: "date",
            required: false,
            fieldName: options?.fields?.lastUsedAt ?? "lastUsedAt",
          },
        },
      },
    },
    rateLimit: (
      Object.keys(DEFAULT_RATE_LIMITS) as (keyof typeof DEFAULT_RATE_LIMITS)[]
    ).map((endpoint) => ({
      pathMatcher: (path: string) => path === NOSTR_PATHS[endpoint],
      ...DEFAULT_RATE_LIMITS[endpoint],
      ...options?.rateLimit?.[endpoint],
    })),
    $ERROR_CODES: NOSTR_ERROR_CODES,
  } satisfies BetterAuthPlugin;
};

export { NOSTR_ERROR_CODES, type NostrErrorCode } from "./error-codes";
export type { NostrOptions };
