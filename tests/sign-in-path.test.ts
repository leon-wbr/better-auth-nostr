import { anonymous } from "better-auth/plugins";
import { describe, expect, it, vi } from "vitest";
import { NOSTR_PATHS } from "../src/endpoints";
import {
  cookiesFromResponse,
  createTestAuth,
  issueNonce,
  makeKeypair,
  signLegacyLoginToken,
  signLoginToken,
  TEST_BASE_URL,
} from "./helpers";

const legacyLogin = async (
  auth: ReturnType<typeof createTestAuth>,
  sign: typeof signLoginToken,
) => {
  const keypair = makeKeypair();
  const nonce = await issueNonce(auth, keypair);
  return auth.api.loginNostr({
    body: { nonce },
    headers: new Headers({ authorization: await sign(keypair, nonce) }),
    asResponse: true,
  });
};

describe("sign-in path", () => {
  it("serves sign-in at /sign-in/nostr, under Better Auth's /sign-in* rules", () => {
    expect(NOSTR_PATHS.login).toBe("/sign-in/nostr");
  });

  it("rejects a token signed for /nostr/login on /sign-in/nostr", async () => {
    const auth = createTestAuth();
    const keypair = makeKeypair();
    const nonce = await issueNonce(auth, keypair);

    await expect(
      auth.api.signInNostr({
        body: { nonce },
        headers: new Headers({
          authorization: await signLegacyLoginToken(keypair, nonce),
        }),
      }),
    ).rejects.toMatchObject({ body: { code: "NOSTR_INVALID_EVENT" } });
  });

  it.each([
    ["/nostr/login", signLegacyLoginToken],
    ["/sign-in/nostr", signLoginToken],
  ])("accepts a token signed for %s on the deprecated /nostr/login", async (_, sign) => {
    const auth = createTestAuth();
    expect((await legacyLogin(auth, sign)).status).toBe(200);
  });

  it("warns once that /nostr/login is deprecated", async () => {
    const auth = createTestAuth();
    const warn = vi.spyOn((await auth.$context).logger, "warn");

    await legacyLogin(auth, signLegacyLoginToken);
    await legacyLogin(auth, signLegacyLoginToken);

    const deprecations = warn.mock.calls.filter(([message]) =>
      /\/nostr\/login.*deprecated/i.test(String(message)),
    );
    expect(deprecations).toHaveLength(1);
  });

  it("links an anonymous user to the Nostr user who signs in", async () => {
    const onLinkAccount = vi.fn();
    const auth = createTestAuth(undefined, {
      plugins: [anonymous({ onLinkAccount })],
    });
    const guest = await auth.handler(
      new Request(`${TEST_BASE_URL}/sign-in/anonymous`, { method: "POST" }),
    );
    const keypair = makeKeypair();
    const nonce = await issueNonce(auth, keypair);
    const headers = cookiesFromResponse(guest);
    headers.set("authorization", await signLoginToken(keypair, nonce));
    headers.set("content-type", "application/json");

    const response = await auth.handler(
      new Request(`${TEST_BASE_URL}${NOSTR_PATHS.login}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ nonce }),
      }),
    );

    expect(response.status).toBe(200);
    const { user } = (await response.json()) as { user: { id: string } };
    expect(onLinkAccount).toHaveBeenCalledOnce();
    expect(onLinkAccount.mock.calls[0]![0].newUser.user.id).toBe(user.id);
  });
});
