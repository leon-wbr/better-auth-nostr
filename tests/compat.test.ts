import { type BetterAuthOptions, betterAuth } from "better-auth";
import {
  type BetterAuthClientPlugin,
  createAuthClient,
} from "better-auth/client";
import {
  adminClient,
  anonymousClient,
  customSessionClient,
  multiSessionClient,
  organizationClient,
} from "better-auth/client/plugins";
import {
  admin,
  anonymous,
  customSession,
  multiSession,
  organization,
} from "better-auth/plugins";
import { generateSecretKey, getPublicKey, nip19 } from "nostr-tools";
import { describe, expect, it, vi } from "vitest";
import { nostrClient } from "../src/client";
import { nostr } from "../src/index";
import type { NostrPubkey } from "../src/types";
import { TEST_ORIGIN } from "./helpers";

const serverOptions = {
  baseURL: TEST_ORIGIN,
  secret: "test-secret-do-not-use-in-production",
} satisfies BetterAuthOptions;

/** A real client whose requests go to `auth.handler`, carrying cookies like a browser. */
const clientFor = <P extends BetterAuthClientPlugin[]>(
  auth: { handler: (request: Request) => Promise<Response> },
  plugins: P,
) => {
  const jar = new Map<string, string>();
  return createAuthClient({
    baseURL: TEST_ORIGIN,
    plugins: [nostrClient(), ...plugins],
    fetchOptions: {
      customFetchImpl: async (input, init) => {
        const request = new Request(input, init);
        request.headers.set("origin", TEST_ORIGIN);
        if (jar.size) {
          request.headers.set(
            "cookie",
            [...jar].map(([name, value]) => `${name}=${value}`).join("; "),
          );
        }
        const response = await auth.handler(request);
        for (const cookie of response.headers.getSetCookie()) {
          const [pair = ""] = cookie.split(";", 1);
          const index = pair.indexOf("=");
          const value = pair.slice(index + 1);
          if (value) jar.set(pair.slice(0, index), value);
          else jar.delete(pair.slice(0, index));
        }
        return response;
      },
    },
  });
};

const makeKey = () => {
  const secretKey = generateSecretKey();
  return {
    nsec: nip19.nsecEncode(secretKey),
    npub: nip19.npubEncode(getPublicKey(secretKey)),
  };
};

describe("anonymous", () => {
  // The plugin links on its own sign-in paths only (`/sign-in/*`, …), and
  // Nostr sign-in is still at /nostr/login. #34 moves it to /sign-in/nostr;
  // this flips to passing then, and `.fails` must be dropped.
  it.fails("links the anonymous user on Nostr sign-in", async () => {
    const onLinkAccount = vi.fn();
    const auth = betterAuth({
      ...serverOptions,
      plugins: [nostr(), anonymous({ onLinkAccount })],
    });
    const client = clientFor(auth, [anonymousClient()]);

    const guest = await client.signIn.anonymous();
    const signedIn = await client.signIn.nostr(makeKey());

    expect(signedIn.error).toBeNull();
    expect(onLinkAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        anonymousUser: expect.objectContaining({
          user: expect.objectContaining({ id: guest.data?.user.id }),
        }),
        newUser: expect.objectContaining({
          user: expect.objectContaining({ id: signedIn.data?.user.id }),
        }),
      }),
    );
  });

  it("signs a guest in with Nostr as a separate, non-anonymous user", async () => {
    const auth = betterAuth({
      ...serverOptions,
      plugins: [nostr(), anonymous()],
    });
    const client = clientFor(auth, [anonymousClient()]);
    const key = makeKey();

    const guest = await client.signIn.anonymous();
    const signedIn = await client.signIn.nostr(key);
    const session = await client.getSession();

    expect(signedIn.error).toBeNull();
    expect(session.data?.user).toMatchObject({
      name: key.npub,
      isAnonymous: false,
    });
    expect(session.data?.user.id).not.toBe(guest.data?.user.id);
  });
});

describe("multiSession", () => {
  it("keeps a session per Nostr key and switches between them", async () => {
    const auth = betterAuth({
      ...serverOptions,
      plugins: [nostr(), multiSession()],
    });
    const client = clientFor(auth, [multiSessionClient()]);
    const alice = makeKey();
    const bob = makeKey();

    const first = await client.signIn.nostr(alice);
    await client.signIn.nostr(bob);

    const sessions = await client.multiSession.listDeviceSessions();
    expect(sessions.data?.map((s) => s.user.name).sort()).toEqual(
      [alice.npub, bob.npub].sort(),
    );
    expect((await client.getSession()).data?.user.name).toBe(bob.npub);

    await client.multiSession.setActive({
      sessionToken: first.data!.session.token,
    });
    expect((await client.getSession()).data?.user.name).toBe(alice.npub);
  });
});

describe("admin", () => {
  const setup = async () => {
    const auth = betterAuth({ ...serverOptions, plugins: [nostr(), admin()] });
    const client = clientFor(auth, [adminClient()]);
    const key = makeKey();
    const { data } = await client.signIn.nostr(key);
    const { internalAdapter } = await auth.$context;
    const userId = data!.user.id;
    const ban = (banExpires?: Date) =>
      internalAdapter.updateUser(userId, {
        banned: true,
        banReason: "spam",
        banExpires,
      });
    const findUser = () => internalAdapter.findUserById(userId);
    return { client, key, ban, findUser };
  };

  it("refuses a banned user's key with BANNED_USER", async () => {
    const { client, key, ban } = await setup();
    await ban();

    const { data, error } = await client.signIn.nostr(key);

    expect(data).toBeNull();
    expect(error).toMatchObject({ status: 403, code: "BANNED_USER" });
  });

  it("signs the user in again once the ban has expired", async () => {
    const { client, key, ban, findUser } = await setup();
    await ban(new Date(Date.now() - 1000));

    const { error } = await client.signIn.nostr(key);

    expect(error).toBeNull();
    expect(await findUser()).toMatchObject({ banned: false, banReason: null });
  });
});

describe("organization", () => {
  it("lets a Nostr user create and switch to an organization", async () => {
    const auth = betterAuth({
      ...serverOptions,
      plugins: [nostr(), organization()],
    });
    const client = clientFor(auth, [organizationClient()]);
    const { data: signedIn } = await client.signIn.nostr(makeKey());

    const { data: org, error } = await client.organization.create({
      name: "Relay Operators",
      slug: "relay-operators",
    });
    expect(error).toBeNull();
    await client.organization.setActive({ organizationId: org!.id });

    const session = await client.getSession();
    expect(session.data?.session.activeOrganizationId).toBe(org!.id);
    const full = await client.organization.getFullOrganization();
    expect(full.data?.members).toEqual([
      expect.objectContaining({ userId: signedIn!.user.id, role: "owner" }),
    ]);
  });
});

describe("customSession", () => {
  it("can add the user's linked pubkeys to the session", async () => {
    const auth = betterAuth({
      ...serverOptions,
      plugins: [
        nostr(),
        customSession(async ({ user, session }, ctx) => {
          const pubkeys = await ctx.context.adapter.findMany<NostrPubkey>({
            model: "nostrPubkey",
            where: [{ field: "userId", value: user.id }],
          });
          return { user, session, pubkeys: pubkeys.map((p) => p.publicKey) };
        }),
      ],
    });
    const client = clientFor(auth, [customSessionClient<typeof auth>()]);
    const key = makeKey();

    await client.signIn.nostr(key);
    const session = await client.getSession();

    expect(session.data?.user.name).toBe(key.npub);
    expect(session.data?.pubkeys).toEqual([
      nip19.decode(key.npub).data as string,
    ]);
  });
});
