import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NOSTR_PATHS } from "../src/endpoints";
import { nostr } from "../src/index";
import type { NostrOptions } from "../src/types";
import { createTestAuth, TEST_BASE_URL } from "./helpers";

const env = vi.hoisted(() => ({ production: false }));
vi.mock("@better-auth/core/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@better-auth/core/env")>()),
  get isProduction() {
    return env.production;
  },
}));

let clients = 0;

/** Better Auth's memory store is global, so each call gets its own client IP. */
const statuses = async (
  auth: ReturnType<typeof createTestAuth>,
  path: string,
  count: number,
) => {
  const ip = `10.0.0.${++clients}`;
  const result: number[] = [];
  for (let i = 0; i < count; i++) {
    const response = await auth.handler(
      new Request(`${TEST_BASE_URL}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": ip },
        body: "{}",
      }),
    );
    result.push(response.status);
  }
  return result;
};

describe("rate limits", () => {
  it.each([
    [NOSTR_PATHS.nonce, 10],
    [NOSTR_PATHS.login, 3],
    ["/nostr/login", 3],
    [NOSTR_PATHS.addPubkey, 5],
  ])("returns 429 past the default limit on %s", async (path, max) => {
    const auth = createTestAuth(undefined, { rateLimit: { enabled: true } });
    const result = await statuses(auth, path, max + 1);
    expect(result.slice(0, max)).not.toContain(429);
    expect(result[max]).toBe(429);
  });

  it("takes per-endpoint overrides from the rateLimit option", async () => {
    const auth = createTestAuth(
      { rateLimit: { login: { window: 60, max: 1 } } },
      { rateLimit: { enabled: true } },
    );
    const [first, second] = await statuses(auth, NOSTR_PATHS.login, 2);
    expect(first).not.toBe(429);
    expect(second).toBe(429);
    expect(await statuses(auth, NOSTR_PATHS.nonce, 10)).not.toContain(429);
  });
});

describe("baseURL", () => {
  afterEach(() => {
    env.production = false;
    vi.unstubAllEnvs();
  });

  const initWithoutBaseURL = (options?: NostrOptions) => {
    vi.stubEnv("BETTER_AUTH_URL", "");
    const log = vi.fn();
    const auth = betterAuth({
      secret: "test-secret-do-not-use-in-production",
      database: memoryAdapter({}),
      logger: { log },
      plugins: [nostr(options)],
    });
    return { context: auth.$context, log };
  };

  const nostrWarnings = (log: ReturnType<typeof vi.fn>) =>
    log.mock.calls.filter(
      ([level, message]) => level === "warn" && /nostr/i.test(message),
    );

  it("warns at init when no baseURL is configured", async () => {
    const { context, log } = initWithoutBaseURL();
    await context;
    expect(nostrWarnings(log)).toHaveLength(1);
  });

  it("does not warn when baseURL comes from BETTER_AUTH_URL", async () => {
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    const log = vi.fn();
    await betterAuth({
      secret: "test-secret-do-not-use-in-production",
      database: memoryAdapter({}),
      logger: { log },
      plugins: [nostr()],
    }).$context;
    expect(nostrWarnings(log)).toHaveLength(0);
  });

  it("fails in production when no baseURL is configured", async () => {
    env.production = true;
    await expect(initWithoutBaseURL().context).rejects.toThrow(
      /allowDynamicBaseURL/,
    );
  });

  it("accepts a missing baseURL in production with allowDynamicBaseURL", async () => {
    env.production = true;
    const { context, log } = initWithoutBaseURL({ allowDynamicBaseURL: true });
    await expect(context).resolves.toBeDefined();
    expect(nostrWarnings(log)).toHaveLength(0);
  });
});
