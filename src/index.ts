/**
 * The server plugin, imported from `better-auth-nostr`.
 * @module better-auth-nostr
 */
import { isProduction } from "@better-auth/core/env";
import { BetterAuthError, type BetterAuthPlugin } from "better-auth";
import { mergeSchema } from "better-auth/db";
import { NOSTR_PATHS } from "./endpoints";
import { NOSTR_ERROR_CODES } from "./error-codes";
import {
  addPubkey,
  backfillAccounts,
  getNostrNonce,
  listPubkeys,
  loginNostr,
  removePubkey,
  removePubkeysOfAccount,
  signInNostr,
  updatePubkey,
} from "./routes";
import { nostrSchema } from "./schema";
import type { NostrOptions } from "./types";
import { PACKAGE_VERSION } from "./version";

const DEFAULT_RATE_LIMITS = {
  nonce: { window: 60, max: 10 },
  login: { window: 10, max: 3 },
  addPubkey: { window: 60, max: 5 },
};

const MISSING_BASE_URL =
  "NIP-98 signatures are checked against the server's URL, and no baseURL is configured, so it is derived from the request's Host header. Set baseURL or BETTER_AUTH_URL, or pass allowDynamicBaseURL: true to the nostr plugin to accept that.";

/** TODO(1.0): remove with the aliases (#34). */
const DEPRECATED_OPTIONS = {
  disableImplicitSignUp: "disableSignUp",
  modelName: "schema.nostrPubkey.modelName",
  fields: "schema.nostrPubkey.fields",
} as const;

/** The server plugin. */
export const nostr = (options?: NostrOptions) => {
  return {
    id: "nostr",
    version: PACKAGE_VERSION,
    /** @hidden */
    init(ctx) {
      if (!ctx.options.baseURL && !options?.allowDynamicBaseURL) {
        if (isProduction) throw new BetterAuthError(MISSING_BASE_URL);
        ctx.logger.warn(`[better-auth-nostr] ${MISSING_BASE_URL}`);
      }
      for (const [old, replacement] of Object.entries(DEPRECATED_OPTIONS)) {
        if (options?.[old as keyof typeof DEPRECATED_OPTIONS] !== undefined) {
          ctx.logger.warn(
            `[better-auth-nostr] ${old} is deprecated and is removed in 1.0; use ${replacement}.`,
          );
        }
      }
      return {
        options: {
          databaseHooks: {
            session: {
              create: {
                after: async (session) => {
                  try {
                    await backfillAccounts(ctx, session.userId);
                  } catch (error) {
                    ctx.logger.warn(
                      "[better-auth-nostr] Could not backfill nostr accounts",
                      error,
                    );
                  }
                },
              },
            },
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
    /** @hidden */
    endpoints: {
      getNostrNonce: getNostrNonce(options),
      signInNostr: signInNostr(options),
      loginNostr: loginNostr(options),
      addPubkey: addPubkey(options),
      listPubkeys: listPubkeys(options),
      updatePubkey: updatePubkey(options),
      removePubkey: removePubkey(options),
    },
    /** @hidden */
    schema: mergeSchema(nostrSchema(), {
      nostrPubkey: {
        modelName:
          options?.schema?.nostrPubkey?.modelName ?? options?.modelName,
        fields: { ...options?.fields, ...options?.schema?.nostrPubkey?.fields },
      },
    }),
    /** @hidden */
    rateLimit: (
      Object.keys(DEFAULT_RATE_LIMITS) as (keyof typeof DEFAULT_RATE_LIMITS)[]
    ).map((endpoint) => ({
      pathMatcher: (path: string) =>
        path === NOSTR_PATHS[endpoint] ||
        (endpoint === "login" && path === NOSTR_PATHS.legacyLogin),
      ...DEFAULT_RATE_LIMITS[endpoint],
      ...options?.rateLimit?.[endpoint],
    })),
    /** @hidden */
    $ERROR_CODES: NOSTR_ERROR_CODES,
  } satisfies BetterAuthPlugin;
};

export { NOSTR_ERROR_CODES, type NostrErrorCode } from "./error-codes";
export type { NostrOptions };

declare module "@better-auth/core" {
  interface BetterAuthPluginRegistry<AuthOptions, Options> {
    nostr: { creator: typeof nostr };
  }
}
