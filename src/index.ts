import type { BetterAuthPlugin } from "better-auth";
import { NOSTR_ERROR_CODES } from "./error-codes";
import { addPubkey, getNostrNonce, loginNostr } from "./routes";
import type { NostrOptions } from "./types";

export const nostr = (options?: NostrOptions) => {
  return {
    id: "nostr",
    endpoints: {
      getNostrNonce: getNostrNonce(options),
      loginNostr: loginNostr(options),
      addPubkey: addPubkey(options),
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
        },
      },
    },
    $ERROR_CODES: NOSTR_ERROR_CODES,
  } satisfies BetterAuthPlugin;
};

export { NOSTR_ERROR_CODES, type NostrErrorCode } from "./error-codes";
export type { NostrOptions };
