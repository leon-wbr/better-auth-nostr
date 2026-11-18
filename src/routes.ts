import type { AuthContext } from "@better-auth/core";
import {
  getCurrentAdapter,
  runWithTransaction,
} from "@better-auth/core/context";
import type { DBAdapter } from "@better-auth/core/db/adapter";
import {
  BASE_ERROR_CODES,
  BetterAuthError,
  type GenericEndpointContext,
  type RawError,
  type User,
} from "better-auth";
import {
  APIError,
  createAuthEndpoint,
  freshSessionMiddleware,
  sessionMiddleware,
} from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { parseAdditionalUserInputFromProviderProfile } from "better-auth/db";
import { nip19 } from "nostr-tools";
import {
  unpackEventFromToken,
  validateEvent,
  validateEventTimestamp,
} from "nostr-tools/nip98";
import * as z from "zod";
import { endpointURL, NOSTR_PATHS } from "./endpoints";
import { NOSTR_ERROR_CODES } from "./error-codes";
import { fetchProfile, type NostrProfile } from "./profile";
import type { NostrMappedUser, NostrOptions, NostrPubkey } from "./types";

const DEFAULT_NONCE_TTL = 5 * 60 * 1000;
const PUBKEY_REGEX = /^[a-f0-9]{64}$/i;

const createDefaultNonce = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

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
    throw APIError.from("UNAUTHORIZED", NOSTR_ERROR_CODES.NOSTR_INVALID_NONCE);
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
    throw APIError.from("BAD_REQUEST", NOSTR_ERROR_CODES.NOSTR_MISSING_TOKEN);
  }

  const nonce = ctx.body.nonce.trim();
  if (!nonce) {
    throw APIError.from("BAD_REQUEST", NOSTR_ERROR_CODES.NOSTR_INVALID_NONCE);
  }

  const event = await unpackEventFromToken(token).catch(() => {
    throw APIError.from("BAD_REQUEST", NOSTR_ERROR_CODES.NOSTR_INVALID_TOKEN);
  });

  const url = endpointURL(ctx.context.baseURL, path);
  await validateEvent(event, url, "post", { nonce }).catch(() => {
    throw APIError.from(
      "UNAUTHORIZED",
      validateEventTimestamp(event)
        ? NOSTR_ERROR_CODES.NOSTR_INVALID_EVENT
        : NOSTR_ERROR_CODES.NOSTR_EVENT_EXPIRED,
    );
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

/** The account row that registers a pubkey with Better Auth's core model. */
const PROVIDER_ID = "nostr";

/**
 * Better Auth 1.7.0 to 1.7.2 require an `issuer` on every account row, unique
 * with `accountId`; later versions have no such column and drop the field.
 */
const nostrAccount = (accountId: string, userId: string) => ({
  providerId: PROVIDER_ID,
  issuer: `local:${PROVIDER_ID}`,
  accountId,
  userId,
});

/**
 * Creates the pubkey row and its account row, inside the caller's
 * transaction when there is one.
 */
const createPubkey = async (
  ctx: GenericEndpointContext,
  data: Pick<NostrPubkey, "publicKey" | "userId" | "name">,
) => {
  const adapter = await getCurrentAdapter(ctx.context.adapter);
  const row = await adapter.create<NostrPubkey>({
    model: MODEL,
    data: { ...data, createdAt: new Date() },
  });
  await ctx.context.internalAdapter.createAccount(
    nostrAccount(data.publicKey, data.userId),
  );
  return row;
};

/**
 * Best effort, so a database that has not been migrated for the column yet
 * still signs in.
 */
const touchPubkey = async (ctx: GenericEndpointContext, id: string) => {
  try {
    await ctx.context.adapter.update({
      model: MODEL,
      where: [{ field: "id", value: id }],
      update: { lastUsedAt: new Date() },
    });
  } catch (error) {
    ctx.context.logger.warn("Could not record the pubkey's last use", error);
  }
};

/** Keeps the pubkey rows in step when Better Auth deletes a nostr account. */
export const removePubkeysOfAccount = async (
  adapter: DBAdapter,
  account: { providerId: string; accountId: string; userId: string },
) => {
  if (account.providerId !== PROVIDER_ID) return;
  await (await getCurrentAdapter(adapter)).deleteMany({
    model: MODEL,
    where: [
      { field: "publicKey", value: account.accountId },
      { field: "userId", value: account.userId },
    ],
  });
};

/**
 * Gives the user's keys linked before 0.8 the account row every key has now.
 * Runs per user (on sign-in and before removing a key) so a large install
 * isn't scanned at startup.
 *
 * @deprecated TODO(1.0): remove (#69). Installs upgrading to 1.0 must have
 * run a 0.x release with it, or the SQL in the upgrade guide (#66).
 */
export const backfillAccounts = async (ctx: AuthContext, userId: string) => {
  const keys = await ctx.adapter.findMany<NostrPubkey>({
    model: MODEL,
    where: [{ field: "userId", value: userId }],
  });
  if (keys.length === 0) return;
  const accounts = await ctx.internalAdapter.findAccounts(userId);
  for (const { publicKey } of keys) {
    if (
      accounts.some(
        (account) =>
          account.providerId === PROVIDER_ID && account.accountId === publicKey,
      )
    ) {
      continue;
    }
    await ctx.internalAdapter.createAccount(nostrAccount(publicKey, userId));
  }
};

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
  error: RawError,
  run: () => Promise<T>,
): Promise<T> => {
  try {
    return await run();
  } catch (cause) {
    ctx.context.logger.error(error.message, cause);
    throw APIError.from("INTERNAL_SERVER_ERROR", error);
  }
};

/**
 * Creates the user and its pubkey row in one transaction, so neither exists
 * without the other. A concurrent first login for the same pubkey makes one
 * of the two inserts fail on a unique index; the loser rolls back and signs
 * in as the user the winner created.
 */
const signUp = async (
  ctx: GenericEndpointContext,
  opts: NostrOptions | undefined,
  pubkey: string,
): Promise<{ user: User; nostrPubkey: NostrPubkey }> => {
  const npub = nip19.npubEncode(pubkey);
  const email =
    (await opts?.generateEmail?.(npub, pubkey)) ?? `${npub}@nostr.local`;
  // Fetched before the transaction, so the relay wait never holds it open.
  const userInfo = await userInfoFromProfile(ctx, opts, pubkey, "create");

  try {
    return await runWithTransaction(ctx.context.adapter, async () => {
      const user = await guardStorage(
        ctx,
        BASE_ERROR_CODES.FAILED_TO_CREATE_USER,
        () =>
          ctx.context.internalAdapter.createUser(
            { ...userInfo, name: userInfo?.name || npub, email },
            { method: "nostr" },
          ),
      );
      if (!user) {
        throw APIError.from(
          "INTERNAL_SERVER_ERROR",
          BASE_ERROR_CODES.FAILED_TO_CREATE_USER,
        );
      }

      const nostrPubkey = await guardStorage(
        ctx,
        NOSTR_ERROR_CODES.NOSTR_FAILED_TO_CREATE_PUBKEY,
        () => createPubkey(ctx, { publicKey: pubkey, userId: user.id }),
      );
      if (!nostrPubkey) {
        throw APIError.from(
          "INTERNAL_SERVER_ERROR",
          NOSTR_ERROR_CODES.NOSTR_FAILED_TO_CREATE_PUBKEY,
        );
      }
      return { user, nostrPubkey };
    });
  } catch (error) {
    const nostrPubkey = await findPubkeyRow(ctx, pubkey);
    const user =
      nostrPubkey &&
      (await ctx.context.internalAdapter.findUserById(nostrPubkey.userId));
    if (!nostrPubkey || !user) throw error;
    return { user, nostrPubkey };
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
        throw new BetterAuthError(
          "getNonce() must return 8-249 characters from [A-Za-z0-9_-]",
        );
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
          throw APIError.from(
            "UNAUTHORIZED",
            NOSTR_ERROR_CODES.NOSTR_PUBKEY_NOT_REGISTERED,
          );
        }

        ({ user, nostrPubkey } = await signUp(ctx, opts, pubkey));
      } else {
        user = await ctx.context.internalAdapter.findUserById(
          nostrPubkey.userId,
        );
        if (!user) {
          throw APIError.from("UNAUTHORIZED", BASE_ERROR_CODES.USER_NOT_FOUND);
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
      const session = await guardStorage(
        ctx,
        BASE_ERROR_CODES.FAILED_TO_CREATE_SESSION,
        () => ctx.context.internalAdapter.createSession(userId),
      );
      // A null session can be a deliberate before-hook denial, so it stays a
      // vague 401 rather than becoming a 500.
      if (!session) {
        throw APIError.from(
          "UNAUTHORIZED",
          BASE_ERROR_CODES.FAILED_TO_CREATE_SESSION,
        );
      }

      await touchPubkey(ctx, nostrPubkey.id);
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
      const { session } = ctx.context;
      const signer = await verifyNip98Request(ctx, NOSTR_PATHS.addPubkey);

      const linked = (pubkey: NostrPubkey) => {
        if (pubkey.userId !== session.user.id) {
          throw APIError.from(
            "CONFLICT",
            NOSTR_ERROR_CODES.NOSTR_PUBKEY_LINKED_TO_OTHER_USER,
          );
        }
        return ctx.json({ pubkey }, { status: 200 });
      };

      const existing = await findPubkeyRow(ctx, signer);
      if (existing) return linked(existing);

      const pubkey = await guardStorage(
        ctx,
        NOSTR_ERROR_CODES.NOSTR_FAILED_TO_CREATE_PUBKEY,
        async () => {
          try {
            return await runWithTransaction(ctx.context.adapter, () =>
              createPubkey(ctx, {
                publicKey: signer,
                userId: session.user.id,
                name: ctx.body.name,
              }),
            );
          } catch (error) {
            // A concurrent add of the same pubkey fails here on the unique
            // index; the loser answers as if it had come second.
            const winner = await findPubkeyRow(ctx, signer);
            if (winner) return winner;
            throw error;
          }
        },
      );
      if (!pubkey) {
        throw APIError.from(
          "INTERNAL_SERVER_ERROR",
          NOSTR_ERROR_CODES.NOSTR_FAILED_TO_CREATE_PUBKEY,
        );
      }
      return linked(pubkey);
    },
  );

/** The caller's own pubkey row; another user's looks the same as a missing one. */
const findOwnPubkey = async (
  ctx: GenericEndpointContext & { context: { session: { user: User } } },
  id: string,
) => {
  const row = await ctx.context.adapter.findOne<NostrPubkey>({
    model: MODEL,
    where: [
      { field: "id", value: id },
      { field: "userId", value: ctx.context.session.user.id },
    ],
  });
  if (!row) {
    throw APIError.from("NOT_FOUND", NOSTR_ERROR_CODES.NOSTR_PUBKEY_NOT_FOUND);
  }
  return row;
};

export const listPubkeys = (_opts?: NostrOptions) =>
  createAuthEndpoint(
    NOSTR_PATHS.listPubkeys,
    {
      method: "GET",
      use: [sessionMiddleware],
      metadata: {
        openapi: {
          operationId: "listNostrPubkeys",
          description: "List the Nostr pubkeys linked to the session user.",
          responses: { 200: { description: "The user's pubkeys." } },
        },
      },
    },
    async (ctx) => {
      const rows = await ctx.context.adapter.findMany<NostrPubkey>({
        model: MODEL,
        where: [{ field: "userId", value: ctx.context.session.user.id }],
      });
      return ctx.json(
        rows.map((row) => ({
          id: row.id,
          publicKey: row.publicKey,
          npub: nip19.npubEncode(row.publicKey),
          name: row.name ?? null,
          createdAt: row.createdAt,
          lastUsedAt: row.lastUsedAt ?? null,
        })),
      );
    },
  );

export const updatePubkey = (_opts?: NostrOptions) =>
  createAuthEndpoint(
    NOSTR_PATHS.updatePubkey,
    {
      method: "POST",
      use: [sessionMiddleware],
      body: z.object({
        id: z.string().min(1),
        name: z.string().min(1).max(120),
      }),
      metadata: {
        openapi: {
          operationId: "updateNostrPubkey",
          description: "Rename one of the session user's Nostr pubkeys.",
          responses: {
            200: { description: "Pubkey renamed." },
            404: { description: "No such pubkey for this user." },
          },
        },
      },
    },
    async (ctx) => {
      const row = await findOwnPubkey(ctx, ctx.body.id);
      const pubkey = await ctx.context.adapter.update<NostrPubkey>({
        model: MODEL,
        where: [{ field: "id", value: row.id }],
        update: { name: ctx.body.name },
      });
      return ctx.json({ pubkey: pubkey ?? { ...row, name: ctx.body.name } });
    },
  );

export const removePubkey = (_opts?: NostrOptions) =>
  createAuthEndpoint(
    NOSTR_PATHS.removePubkey,
    {
      method: "POST",
      use: [freshSessionMiddleware],
      body: z.object({ id: z.string().min(1) }),
      metadata: {
        openapi: {
          operationId: "removeNostrPubkey",
          description:
            "Unlink one of the session user's Nostr pubkeys. Refused for " +
            "the user's last way to sign in unless " +
            "account.accountLinking.allowUnlinkingAll is set.",
          responses: {
            200: { description: "Pubkey removed." },
            400: { description: "It is the user's last way to sign in." },
            404: { description: "No such pubkey for this user." },
          },
        },
      },
    },
    async (ctx) => {
      const row = await findOwnPubkey(ctx, ctx.body.id);
      const isThisKey = (account: { providerId: string; accountId: string }) =>
        account.providerId === PROVIDER_ID &&
        account.accountId === row.publicKey;

      await backfillAccounts(ctx.context, row.userId);
      const accounts = await ctx.context.internalAdapter.findAccounts(
        row.userId,
      );
      if (
        !accounts.some((account) => !isThisKey(account)) &&
        !ctx.context.options.account?.accountLinking?.allowUnlinkingAll
      ) {
        throw APIError.from(
          "BAD_REQUEST",
          NOSTR_ERROR_CODES.NOSTR_CANNOT_REMOVE_LAST_PUBKEY,
        );
      }

      await runWithTransaction(ctx.context.adapter, async () => {
        const adapter = await getCurrentAdapter(ctx.context.adapter);
        await adapter.delete({
          model: MODEL,
          where: [{ field: "id", value: row.id }],
        });
        for (const account of accounts.filter(isThisKey)) {
          await ctx.context.internalAdapter.deleteAccount(account.id);
        }
      });
      return ctx.json({ status: true });
    },
  );
