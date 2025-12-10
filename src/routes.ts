import { createAuthEndpoint } from "@better-auth/core/api";
import type { User } from "better-auth";
import { APIError } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { nip19 } from "nostr-tools";
import { unpackEventFromToken, validateEvent } from "nostr-tools/nip98";
import type { NostrOptions, NostrPubkey } from "./types";

export const loginNostr = (opts?: NostrOptions) =>
  createAuthEndpoint(
    "/nostr/login",
    {
      method: "POST",
      disableBody: true,
      metadata: {
        openapi: {
          operationId: "loginNostr",
          description: "Login using Nostr (NIP-98)",
          responses: {
            200: {
              description: "Success",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Nostr",
                  },
                },
              },
            },
            400: {
              description: "Bad request",
            },
          },
        },
      },
    },
    async (ctx) => {
      const token = ctx.headers?.get("authorization") || "";
      if (!token) {
        throw new APIError("BAD_REQUEST", {
          message: "Missing authorization token",
        });
      }

      const event = await unpackEventFromToken(token).catch((error) => {
        throw new APIError("BAD_REQUEST", {
          message: error.message || "Invalid token",
        });
      });

      const loginUrl = new URL(ctx.request?.url ?? "");
      loginUrl.search = "";
      loginUrl.hash = "";

      await validateEvent(event, loginUrl.toString(), "post").catch((error) => {
        throw new APIError("UNAUTHORIZED", {
          message: error.message || "Invalid event",
        });
      });

      let nostrPubkey = await ctx.context.adapter.findOne<NostrPubkey>({
        model: "nostrPubkey",
        where: [{ field: "publicKey", value: event.pubkey }],
      });

      let user: User | null = null;

      if (!nostrPubkey && opts?.disableImplicitSignUp) {
        throw new APIError("UNAUTHORIZED", {
          message: "Nostr pubkey not registered",
        });
      } else if (!nostrPubkey) {
        const pubkeyData = {
          publicKey: event.pubkey,
          createdAt: new Date(),
        } satisfies Omit<NostrPubkey, "userId">;

        const npub = nip19.npubEncode(pubkeyData.publicKey);

        /** @todo Try to fetch user profile from relays given in options. */
        user = await ctx.context.internalAdapter.createUser({
          email: `${npub}@anchorman.lol`,
          name: npub,
        });
        if (!user) {
          throw new APIError("BAD_REQUEST", {
            message: "Failed to create user",
          });
        }

        nostrPubkey = await ctx.context.adapter.create<NostrPubkey>({
          model: "nostrPubkey",
          data: {
            ...pubkeyData,
            userId: user.id,
          },
        });
        if (!nostrPubkey) {
          throw new APIError("BAD_REQUEST", {
            message: "Failed to create nostr pubkey",
          });
        }
      } else {
        user = await ctx.context.internalAdapter.findUserById(
          nostrPubkey.userId
        );
        if (!user) {
          throw new APIError("UNAUTHORIZED", {
            message: "User not found",
          });
        }
      }

      try {
        const session = await ctx.context.internalAdapter.createSession(
          nostrPubkey.userId
        );
        if (!session) {
          throw new APIError("UNAUTHORIZED", {
            message: "Failed to create session",
          });
        }

        await setSessionCookie(ctx, { session, user });
        return ctx.json({ session }, { status: 200 });
      } catch (error) {
        ctx.context.logger.error("Failed to login with Nostr", error);
        throw new APIError("BAD_REQUEST", {
          message: "Failed to login with Nostr",
        });
      }
    }
  );
