import type { BetterAuthPlugin } from "better-auth";
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
  } satisfies BetterAuthPlugin;
};

export type { NostrOptions };
