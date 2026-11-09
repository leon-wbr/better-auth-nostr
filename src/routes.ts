import { randomBytes } from "node:crypto";
import type { GenericEndpointContext, User } from "better-auth";
import {
  APIError,
  createAuthEndpoint,
  sessionMiddleware,
} from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { parseAdditionalUserInputFromProviderProfile } from "better-auth/db";
import { nip19 } from "nostr-tools";
import { unpackEventFromToken, validateEvent } from "nostr-tools/nip98";
import * as z from "zod";
import { endpointURL, NOSTR_PATHS } from "./endpoints";
import { fetchProfile, type NostrProfile } from "./profile";
import type { NostrMappedUser, NostrOptions, NostrPubkey } from "./types";

const DEFAULT_NONCE_TTL = 5 * 60 * 1000;
const PUBKEY_REGEX = /^[a-f0-9]{64}$/i;

const createDefaultNonce = () => randomBytes(16).toString("hex");

const VERIFICATION_PREFIX = "nostr:";
/** Fits Better Auth's 255-character verification identifier with the prefix. */
const NONCE_REGEX = /^[A-Za-z0-9_-]{8,249}$/;

/**
 * Each nonce gets its own verification row, keyed by the nonce and holding
 * the pubkey it was issued for, so nonces for one pubkey don't replace each
 * other.
 */
const verificationKey = (nonce: string) => `${VERIFICATION_PREFIX}${nonce}`;

/**
 * Consumes the nonce exactly once and checks that it was issued for the
 * pubkey that signed the event.
 */
const consumeNonce = async (
  ctx: GenericEndpointContext,
  nonce: string,
  pubkey: string,
) => {
  const verification =
    await ctx.context.internalAdapter.consumeVerificationValue(
      verificationKey(nonce),
    );
  if (!verification || verification.value !== pubkey.toLowerCase()) {
    throw new APIError("UNAUTHORIZED", {
      message: "Invalid or expired nonce",
    });
  }
};

/**
 * Runs every check a NIP-98 request has to pass before it is trusted: a
 * token in the Authorization header, a nonce in the body, a valid event
 * signed for this endpoint's URL, method and body, and a nonce that was
 * issued for the signer and is consumed here, once. Returns the signer.
 */
const verifyNip98Request = async (
  ctx: GenericEndpointContext & { body: { nonce: string } },
  path: typeof NOSTR_PATHS.login | typeof NOSTR_PATHS.addPubkey,
): Promise<string> => {
  const token = ctx.headers?.get("authorization");
  if (!token) {
    throw new APIError("BAD_REQUEST", {
      message: "Missing NIP-98 authorization token",
    });
  }

  const nonce = ctx.body.nonce.trim();
  if (!nonce) {
    throw new APIError("BAD_REQUEST", { message: "Missing nonce" });
  }

  const event = await unpackEventFromToken(token).catch((error: unknown) => {
    throw new APIError("BAD_REQUEST", {
      message: (error instanceof Error && error.message) || "Invalid token",
    });
  });

  const url = endpointURL(ctx.context.baseURL, path);
  await validateEvent(event, url, "post", { nonce }).catch((error: unknown) => {
    throw new APIError("UNAUTHORIZED", {
      message:
        (error instanceof Error && error.message) || "Invalid NIP-98 event",
    });
  });

  await consumeNonce(ctx, nonce, event.pubkey);
  return event.pubkey;
};

/**
 * The schema key of the pubkey model. Adapter calls use schema keys and Better
 * Auth maps them to the configured `modelName` and `fields`.
 */
const MODEL = "nostrPubkey";

const findPubkeyRow = (ctx: GenericEndpointContext, pubkey: string) =>
  ctx.context.adapter.findOne<NostrPubkey>({
    model: MODEL,
    where: [{ field: "publicKey", value: pubkey }],
  });

const httpsUrl = z.url({ protocol: /^https$/ });

const defaultProfileMapping = ({ metadata }: NostrProfile): NostrMappedUser => {
  const name = [metadata.display_name, metadata.name]
    .map((value) => value?.trim())
    .find(Boolean);
  const image = httpsUrl.safeParse(metadata.picture);
  return {
    ...(name && { name }),
    ...(image.success && { image: image.data }),
  };
};

/** Best effort, like the rest of relay access: any failure maps to no fields. */
const userInfoFromProfile = async (
  ctx: GenericEndpointContext,
  opts: NostrOptions | undefined,
  pubkey: string,
  action: "create" | "update",
): Promise<
  ({ name?: string; image?: string } & Record<string, unknown>) | null
> => {
  if (!opts?.relays) return null;
  try {
    const profile = await fetchProfile(pubkey, {
      relays: opts.relays,
      timeoutMs: opts.relayTimeoutMs,
    });
    if (!profile) return null;
    const {
      id: _id,
      email: _email,
      emailVerified: _emailVerified,
      name,
      image,
      ...extra
    } = {
      ...defaultProfileMapping(profile),
      ...(await opts.mapProfileToUser?.(profile)),
    };
    return {
      name,
      image,
      ...parseAdditionalUserInputFromProviderProfile(
        ctx.context.options,
        extra,
        action,
      ),
    };
  } catch (error) {
    ctx.context.logger.warn(
      "Could not fill user info from Nostr profile",
      error,
    );
    return null;
  }
};

/**
 * Runs a storage call and turns a thrown error into a generic 500. The detail
 * goes to the server log only, never into the response body.
 */
const guardStorage = async <T>(
  ctx: {
    context: {
      logger: { error: (message: string, ...args: unknown[]) => void };
    };
  },
  message: string,
  run: () => Promise<T>,
): Promise<T> => {
  try {
    return await run();
  } catch (error) {
    ctx.context.logger.error(message, error);
    throw new APIError("INTERNAL_SERVER_ERROR", { message });
  }
};

export const getNostrNonce = (opts?: NostrOptions) =>
  createAuthEndpoint(
    NOSTR_PATHS.nonce,
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
      if (!NONCE_REGEX.test(nonce)) {
        throw new APIError("INTERNAL_SERVER_ERROR", {
          message: "getNonce() must return 8-249 characters from [A-Za-z0-9_-]",
        });
      }

      await ctx.context.internalAdapter.createVerificationValue({
        identifier: verificationKey(nonce),
        value: publicKey.toLowerCase(),
        expiresAt: new Date(Date.now() + ttlMs),
      });

      return ctx.json({ nonce }, { status: 200 });
    },
  );

export const loginNostr = (opts?: NostrOptions) =>
  createAuthEndpoint(
    NOSTR_PATHS.login,
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
      const pubkey = await verifyNip98Request(ctx, NOSTR_PATHS.login);

      let nostrPubkey = await findPubkeyRow(ctx, pubkey);

      let user: User | null = null;

      if (!nostrPubkey) {
        if (opts?.disableImplicitSignUp) {
          throw new APIError("UNAUTHORIZED", {
            message: "Nostr pubkey not registered",
          });
        }

        const npub = nip19.npubEncode(pubkey);
        const email =
          (await opts?.generateEmail?.(npub, pubkey)) ?? `${npub}@nostr.local`;

        const userInfo = await userInfoFromProfile(ctx, opts, pubkey, "create");

        user = await ctx.context.internalAdapter.createUser(
          {
            ...userInfo,
            name: userInfo?.name || npub,
            email,
          },
          { method: "nostr" },
        );
        if (!user) {
          throw new APIError("INTERNAL_SERVER_ERROR", {
            message: "Failed to create user",
          });
        }

        nostrPubkey = await ctx.context.adapter.create<NostrPubkey>({
          model: MODEL,
          data: {
            publicKey: pubkey,
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

        if (opts?.overrideUserInfoOnSignIn) {
          const userInfo = await userInfoFromProfile(
            ctx,
            opts,
            pubkey,
            "update",
          );
          if (userInfo) {
            user =
              (await ctx.context.internalAdapter.updateUser(
                user.id,
                userInfo,
              )) ?? user;
          }
        }
      }

      const userId = nostrPubkey.userId;
      const session = await guardStorage(ctx, "Failed to create session", () =>
        ctx.context.internalAdapter.createSession(userId),
      );
      // A null session can be a deliberate before-hook denial, so it stays a
      // vague 401 rather than becoming a 500.
      if (!session) {
        throw new APIError("UNAUTHORIZED", {
          message: "Failed to create session",
        });
      }

      await setSessionCookie(ctx, { session, user });
      return ctx.json({ session, user }, { status: 200 });
    },
  );

export const addPubkey = (_opts?: NostrOptions) =>
  createAuthEndpoint(
    NOSTR_PATHS.addPubkey,
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

      const signer = await verifyNip98Request(ctx, NOSTR_PATHS.addPubkey);

      const existing = await findPubkeyRow(ctx, signer);

      if (existing && existing.userId !== session.user.id) {
        throw new APIError("CONFLICT", {
          message: "Pubkey is already linked to another account",
        });
      }
      if (existing) {
        return ctx.json({ pubkey: existing }, { status: 200 });
      }

      const pubkey = await guardStorage(
        ctx,
        "Failed to create Nostr pubkey",
        () =>
          ctx.context.adapter.create<NostrPubkey>({
            model: MODEL,
            data: {
              publicKey: signer,
              userId: session.user.id,
              name: ctx.body.name,
              createdAt: new Date(),
            },
          }),
      );
      if (!pubkey) {
        throw new APIError("INTERNAL_SERVER_ERROR", {
          message: "Failed to create Nostr pubkey",
        });
      }

      return ctx.json({ pubkey }, { status: 200 });
    },
  );
