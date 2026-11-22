import type { BetterAuthPluginDBSchema } from "@better-auth/core/db";

/** A fresh copy on every call, because `mergeSchema` renames in place. */
export const nostrSchema = () =>
  ({
    nostrPubkey: {
      modelName: "nostrPubkey",
      fields: {
        name: { type: "string", required: false },
        publicKey: {
          type: "string",
          required: true,
          unique: true,
          index: true,
        },
        userId: {
          type: "string",
          required: true,
          references: { model: "user", field: "id", onDelete: "cascade" },
          index: true,
        },
        createdAt: { type: "date", required: true },
        lastUsedAt: { type: "date", required: false },
      },
    },
  }) satisfies BetterAuthPluginDBSchema;

export type NostrSchema = ReturnType<typeof nostrSchema>;
