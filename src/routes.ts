import type { User } from "better-auth";
import {
  APIError,
  createAuthEndpoint,
  sessionMiddleware,
} from "better-auth/api";
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
        const email =
          (await opts?.generateEmail?.(npub, event.pubkey)) ??
          `${npub}@nostr.local`;

        user = await ctx.context.internalAdapter.createUser(
          {
            email,
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

export const addPubkey = (opts?: NostrOptions) =>
  createAuthEndpoint(
    "/nostr/add-pubkey",
    {
      method: "POST",
      use: [sessionMiddleware],
      body: z.object({
        nonce: z.string().min(1, "nonce is required"),
        name: z.string().min(1).max(120).optional(),
      }),
      metadata: {
        openapi: {
          operationId: "addNostrPubkey",
          description:
            "Attach an additional Nostr pubkey to the authenticated user. " +
            "Requires a fresh NIP-98 token in the Authorization header.",
          responses: {
            200: { description: "Pubkey linked." },
            400: { description: "Bad request." },
            401: { description: "Unauthorized." },
            409: { description: "Pubkey already linked to another user." },
          },
        },
      },
    },
    async (ctx) => {
      const session = ctx.context.session;
      if (!session) {
        throw new APIError("UNAUTHORIZED", { message: "Not signed in" });
      }

      const token = ctx.headers?.get("authorization") ?? "";
      if (!token) {
        throw new APIError("BAD_REQUEST", {
          message: "Missing NIP-98 authorization token",
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

      const addUrl = buildEndpointUrl(ctx.context.baseURL, "/nostr/add-pubkey");
      await validateEvent(event, addUrl, "post", { nonce }).catch((error) => {
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

      const existing = await ctx.context.adapter.findOne<NostrPubkey>({
        model,
        where: [{ field: pubkeyField, value: event.pubkey }],
      });

      if (existing && existing.userId !== session.user.id) {
        throw new APIError("CONFLICT", {
          message: "Pubkey is already linked to another account",
        });
      }
      if (existing) {
        return ctx.json({ pubkey: existing }, { status: 200 });
      }

      const pubkey = await ctx.context.adapter.create<NostrPubkey>({
        model,
        data: {
          publicKey: event.pubkey,
          userId: session.user.id,
          name: ctx.body.name,
          createdAt: new Date(),
        },
      });

      return ctx.json({ pubkey }, { status: 200 });
    },
  );
