import { NIP05_REGEX } from "nostr-tools/nip05";

export const DEFAULT_NIP05_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 256 * 1024;

/** Private, loopback, link-local, CGNAT, multicast and reserved ranges. */
const BLOCKED_SUBNETS: [string, number, "ipv4" | "ipv6"][] = [
  ["0.0.0.0", 8, "ipv4"],
  ["10.0.0.0", 8, "ipv4"],
  ["100.64.0.0", 10, "ipv4"],
  ["127.0.0.0", 8, "ipv4"],
  ["169.254.0.0", 16, "ipv4"],
  ["172.16.0.0", 12, "ipv4"],
  ["192.168.0.0", 16, "ipv4"],
  ["224.0.0.0", 3, "ipv4"],
  ["::", 127, "ipv6"],
  ["fc00::", 7, "ipv6"],
  ["fe80::", 10, "ipv6"],
  ["ff00::", 8, "ipv6"],
];

/**
 * Whether a host resolves to a blocked address, or `null` without `node:dns`
 * (Workers, Deno Deploy), where `allowedDomains` is the only boundary. The
 * fetch resolves the host again, so DNS rebinding can still get past it.
 */
const loadPrivateHostCheck = async () => {
  try {
    const [{ lookup }, { BlockList }] = await Promise.all([
      import("node:dns/promises"),
      import("node:net"),
    ]);
    const blocked = new BlockList();
    for (const [network, prefix, type] of BLOCKED_SUBNETS) {
      blocked.addSubnet(network, prefix, type);
    }
    return async (host: string) =>
      (await lookup(host, { all: true })).some(({ address, family }) =>
        blocked.check(address, family === 6 ? "ipv6" : "ipv4"),
      );
  } catch {
    return null;
  }
};
let privateHostCheck: ReturnType<typeof loadPrivateHostCheck> | undefined;

const readCapped = async (body: ReadableStream<Uint8Array>) => {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
};

/**
 * Checks a NIP-05 claim against the domain's `nostr.json` without nostr-tools'
 * process-wide fetch. Resolves to the normalized `name@domain` when it maps to
 * `pubkey`, and to `null` on a mismatch or any failure.
 */
export const verifyNip05 = async (
  claim: string,
  pubkey: string,
  {
    allowedDomains,
    timeoutMs,
  }: { allowedDomains?: readonly string[]; timeoutMs: number },
): Promise<string | null> => {
  try {
    const [, local = "_", host] = claim.trim().match(NIP05_REGEX) ?? [];
    if (!host) return null;
    const name = local.toLowerCase();
    const domain = host.toLowerCase();
    if (
      allowedDomains &&
      !allowedDomains.some((allowed) => allowed.toLowerCase() === domain)
    ) {
      return null;
    }
    const url = new URL(`https://${domain}/.well-known/nostr.json`);
    if (/^[\d.]+$/.test(url.hostname)) return null;
    privateHostCheck ??= loadPrivateHostCheck();
    if (await (await privateHostCheck)?.(url.hostname)) return null;

    url.searchParams.set("name", name);
    const res = await fetch(url, {
      redirect: "manual",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status !== 200 || !res.body) return null;
    const text = await readCapped(res.body);
    if (text === null) return null;
    const mapped = JSON.parse(text)?.names?.[name];
    return typeof mapped === "string" &&
      mapped.toLowerCase() === pubkey.toLowerCase()
      ? `${name}@${domain}`
      : null;
  } catch {
    return null;
  }
};
