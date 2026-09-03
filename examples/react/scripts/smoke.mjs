/**
 * End-to-end smoke test against a running dev server. Covers the paths that
 * are awkward to drive from the UI: nonce replay, a token signed for another
 * URL, a spoofed Host header, and add-pubkey without a session.
 *
 *   npm run dev
 *   npm run smoke
 *
 * Honors the same BETTER_AUTH_URL / AUTH_BASE_PATH variables as the app.
 */
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools";
import { getToken } from "nostr-tools/nip98";

const BASE = process.env.BETTER_AUTH_URL ?? "http://localhost:5173";
const AUTH = `${BASE}${process.env.AUTH_BASE_PATH ?? "/api/auth"}`;

const post = async (path, body, headers = {}) => {
  const res = await fetch(`${AUTH}${path}`, {
    method: "POST",
    // Session-authenticated endpoints sit behind Better Auth's CSRF check,
    // which a browser satisfies automatically and a script does not.
    headers: { "content-type": "application/json", origin: BASE, ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json, cookie: res.headers.get("set-cookie") };
};

const nonceFor = async (publicKey) => {
  const { status, json } = await post("/nostr/nonce", { publicKey });
  if (status !== 200) {
    throw new Error(`nonce request failed: ${status} ${JSON.stringify(json)}`);
  }
  return json.nonce;
};

const mint = (url, secretKey, nonce) =>
  getToken(url, "post", (event) => finalizeEvent(event, secretKey), true, {
    nonce,
  });

const check = (label, passed, detail = "") => {
  console.log(
    `${passed ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`,
  );
  if (!passed) process.exitCode = 1;
};

const skA = generateSecretKey();
const pkA = getPublicKey(skA);

let nonce = await nonceFor(pkA);
let token = await mint(`${AUTH}/nostr/login`, skA, nonce);
const login = await post("/nostr/login", { nonce }, { authorization: token });
check(
  "login creates a user and a session",
  login.status === 200 && Boolean(login.json.user?.id),
  `status=${login.status} email=${login.json.user?.email}`,
);

const cookie = (login.cookie ?? "")
  .split(",")
  .map((part) => part.split(";")[0].trim())
  .join("; ");
const userId = login.json.user?.id;

const replay = await post("/nostr/login", { nonce }, { authorization: token });
check(
  "a replayed nonce is rejected",
  replay.status === 401,
  `status=${replay.status}`,
);

const skB = generateSecretKey();
const pkB = getPublicKey(skB);

nonce = await nonceFor(pkB);
token = await mint(`${AUTH}/nostr/add-pubkey`, skB, nonce);
const add = await post(
  "/nostr/add-pubkey",
  { nonce, name: "second signer" },
  { authorization: token, cookie },
);
check(
  "add-pubkey links a second key",
  add.status === 200 && add.json.pubkey?.publicKey === pkB,
  `status=${add.status}`,
);

nonce = await nonceFor(pkB);
token = await mint(`${AUTH}/nostr/add-pubkey`, skB, nonce);
const unauthenticated = await post(
  "/nostr/add-pubkey",
  { nonce },
  { authorization: token },
);
check(
  "add-pubkey without a session is rejected",
  unauthenticated.status === 401,
  `status=${unauthenticated.status}`,
);

nonce = await nonceFor(pkB);
token = await mint(`${AUTH}/nostr/login`, skB, nonce);
const loginB = await post("/nostr/login", { nonce }, { authorization: token });
check(
  "logging in with the linked key lands on the same user",
  loginB.status === 200 && loginB.json.user?.id === userId,
  `status=${loginB.status}`,
);

const skC = generateSecretKey();
const pkC = getPublicKey(skC);

nonce = await nonceFor(pkC);
token = await mint("http://evil.example/api/auth/nostr/login", skC, nonce);
const wrongUrl = await post(
  "/nostr/login",
  { nonce },
  { authorization: token },
);
check(
  "a token signed for another URL is rejected",
  wrongUrl.status === 401,
  `status=${wrongUrl.status}`,
);

nonce = await nonceFor(pkC);
token = await mint("http://evil.example/api/auth/nostr/login", skC, nonce);
const spoofed = await post(
  "/nostr/login",
  { nonce },
  {
    authorization: token,
    host: "evil.example",
    "x-forwarded-host": "evil.example",
  },
);
check(
  "a spoofed Host header does not move the validated URL",
  spoofed.status === 401,
  `status=${spoofed.status}`,
);
