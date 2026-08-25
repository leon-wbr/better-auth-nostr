import type { User } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { randomBytes } from "node:crypto";
import { nip19 } from "nostr-tools";
import { unpackEventFromToken, validateEvent } from "nostr-tools/nip98";
import * as z from "zod";
import type { NostrOptions, NostrPubkey } from "./types";

const DEFAULT_NONCE_TTL = 5 * 60 * 1000;
const PUBKEY_REGEX = /^[a-f0-9]{64}$/i;

const createDefaultNonce = () => randomBytes(16).toString("hex");

const verificationKey = (publicKey: string) => `nostr:${publicKey}`;

const buildEndpointUrl = (baseURL: string, path: string) => {
  const trimmed = baseURL.endsWith("/") ? baseURL.slice(0, -1) : baseURL;
  return `${trimmed}${path.startsWith("/") ? path : `/${path}`}`;
};

const resolveModel = (opts?: NostrOptions) => ({
  model: opts?.modelName ?? "nostrPubkey",
  pubkeyField: opts?.fields?.publicKey ?? "publicKey",
});

export const getNostrNonce = (opts?: NostrOptions) =>
  createAuthEndpoint(
    "/nostr/nonce",
    {
      method: "POST",
      body: z.object({
        publicKey: z
          .string()
          .regex(PUBKEY_REGEX, "publicKey must be 64 hex chars"),
      }),
      metadata: {
        openapi: {
          operationId: "getNostrNonce",
          description: "Issue a one-time nonce bound to a Nostr public key.",
          responses: {
            200: {
              description: "Success",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["nonce"],
                    properties: { nonce: { type: "string" } },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (ctx) => {
      const { publicKey } = ctx.body;
      const ttlMs = opts?.nonceTtlMs ?? DEFAULT_NONCE_TTL;
      const nonce = (await opts?.getNonce?.()) ?? createDefaultNonce();

      await ctx.context.internalAdapter.createVerificationValue({
        identifier: verificationKey(publicKey),
        value: nonce,
        expiresAt: new Date(Date.now() + ttlMs),
      });

      return ctx.json({ nonce }, { status: 200 });
    },
  );

export const loginNostr = (opts?: NostrOptions) =>
  createAuthEndpoint(
    "/nostr/login",
    {
      method: "POST",
      body: z.object({
        nonce: z.string().min(1, "nonce is required"),
      }),
      metadata: {
        openapi: {
          operationId: "loginNostr",
          description: "Login using a NIP-98 signed HTTP token.",
          responses: {
            200: { description: "Session created." },
            400: { description: "Bad request." },
            401: { description: "Unauthorized." },
          },
        },
      },
    },
    async (ctx) => {
      const token = ctx.headers?.get("authorization") ?? "";
      if (!token) {
        throw new APIError("BAD_REQUEST", {
          message: "Missing authorization token",
        });
      }

      const nonce = ctx.body.nonce.trim();
      if (!nonce) {
        throw new APIError("BAD_REQUEST", { message: "Missing nonce" });
      }

      const event = await unpackEventFromToken(token).catch((error) => {
        throw new APIError("BAD_REQUEST", {
          message: error?.message || "Invalid token",
        });
      });

      const loginUrl = buildEndpointUrl(ctx.context.baseURL, "/nostr/login");
      await validateEvent(event, loginUrl, "post", { nonce }).catch((error) => {
        throw new APIError("UNAUTHORIZED", {
          message: error?.message || "Invalid NIP-98 event",
        });
      });

      const verification =
        await ctx.context.internalAdapter.consumeVerificationValue(
          verificationKey(event.pubkey),
        );

      if (!verification || verification.value !== nonce) {
        throw new APIError("UNAUTHORIZED", {
          message: "Invalid or expired nonce",
        });
      }

      const { model, pubkeyField } = resolveModel(opts);

      let nostrPubkey = await ctx.context.adapter.findOne<NostrPubkey>({
        model,
        where: [{ field: pubkeyField, value: event.pubkey }],
      });

      let user: User | null = null;

      if (!nostrPubkey) {
        if (opts?.disableImplicitSignUp) {
          throw new APIError("UNAUTHORIZED", {
            message: "Nostr pubkey not registered",
          });
        }

        const npub = nip19.npubEncode(event.pubkey);

        user = await ctx.context.internalAdapter.createUser(
          {
            email: `${npub}@anchorman.lol`,
            name: npub,
          },
          { method: "nostr" },
        );
        if (!user) {
          throw new APIError("INTERNAL_SERVER_ERROR", {
            message: "Failed to create user",
          });
        }

        nostrPubkey = await ctx.context.adapter.create<NostrPubkey>({
          model,
          data: {
            publicKey: event.pubkey,
            userId: user.id,
            createdAt: new Date(),
          },
        });
        if (!nostrPubkey) {
          throw new APIError("INTERNAL_SERVER_ERROR", {
            message: "Failed to create Nostr pubkey",
          });
        }
      } else {
        user = await ctx.context.internalAdapter.findUserById(
          nostrPubkey.userId,
        );
        if (!user) {
          throw new APIError("UNAUTHORIZED", { message: "User not found" });
        }
      }

      const session = await ctx.context.internalAdapter.createSession(
        nostrPubkey.userId,
      );
      if (!session) {
        throw new APIError("UNAUTHORIZED", {
          message: "Failed to create session",
        });
      }

      await setSessionCookie(ctx, { session, user });
      return ctx.json({ session, user }, { status: 200 });
    },
  );
