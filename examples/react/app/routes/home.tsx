import {
  createBunkerSigner,
  createNostrConnectSession,
  type RemoteNostrSigner,
} from "better-auth-nostr/client";
import { generateSecretKey, nip19 } from "nostr-tools";
import { useState } from "react";
import {
  type LoaderFunctionArgs,
  useLoaderData,
  useRevalidator,
} from "react-router";
import Button from "~/components/ui/Button";
import { authClient } from "~/lib/auth";
import { auth, db } from "~/lib/auth.server";

const isDate = (key: string): boolean =>
  ["createdAt", "expiresAt", "updatedAt"].some(
    (dateKey) => dateKey.toLowerCase() === key.toLowerCase(),
  );

type LinkedPubkey = {
  id: string;
  name: string | null;
  publicKey: string;
  userId: string;
  createdAt: string;
};

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return { linked: [] as LinkedPubkey[] };

  const linked = db
    .prepare(
      `select "id", "name", "publicKey", "userId", "createdAt"
       from "nostrPubkey" where "userId" = ? order by "createdAt" asc`,
    )
    .all(session.user.id) as LinkedPubkey[];

  return { linked };
}

function RecursiveEntry({ value }: { value: any }) {
  if (typeof value === "object" && value !== null) {
    if (Array.isArray(value)) {
      return (
        <ul className="ml-4 list-disc">
          {value.map((item, idx) => (
            <li key={idx}>
              <RecursiveEntry value={item} />
            </li>
          ))}
        </ul>
      );
    }

    const cellClassName = (includePadding: boolean) =>
      `${includePadding ? "p-3" : ""} text-zinc-400 whitespace-nowrap align-top bg-zinc-800 hover:bg-zinc-700 transition-colors`;

    // Render object as a grid
    return (
      <div className="inline-grid grid-cols-[minmax(120px,auto)_minmax(0,1fr)] text-xs min-w-0 w-full max-w-ful">
        {Object.entries(value).map(([k, v]) => (
          <div key={k} className="contents">
            <div className={cellClassName(true)}>
              {k.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase()}
            </div>
            <div
              className={cellClassName(
                typeof v !== "object" || v === null || isDate(k),
              )}
            >
              {!isDate(k) ? (
                <RecursiveEntry value={v} />
              ) : (
                new Date(v as string).toString()
              )}
            </div>
          </div>
        ))}
      </div>
    );
  }
  return <span>{String(value)}</span>;
}

type ClientError = {
  code?: string;
  message?: string;
  status?: number;
  statusText?: string;
};

// The client action returns a union: a plain fetch error has no `code`, while
// an error thrown before the request (bad nsec, no NIP-07) carries one.
const formatError = (error: ClientError) =>
  `${error.code ?? error.status ?? "error"}: ${error.message ?? "Unknown error"}`;

function Status({
  status,
}: {
  status: { ok: boolean; message: string } | null;
}) {
  if (!status) return null;
  return (
    <p
      className={`text-[11px] font-mono break-all ${
        status.ok ? "text-emerald-400" : "text-red-400"
      }`}
    >
      {status.message}
    </p>
  );
}

function NsecField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-xs text-zinc-300">
        Private key
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="nsec1... or 64-char hex"
          className="flex-1 px-2 py-1 border dark:bg-zinc-800 dark:border-zinc-700 text-zinc-100 text-xs"
        />
        <button
          type="button"
          onClick={() => onChange(nip19.nsecEncode(generateSecretKey()))}
          className="px-3 py-1 text-[10px] font-semibold tracking-widest border rounded uppercase bg-transparent border-zinc-700 text-zinc-400 hover:border-zinc-500"
        >
          Generate
        </button>
      </div>
      <p className="text-[10px] text-zinc-500">
        Your key stays in the browser for this session.
      </p>
    </div>
  );
}

type AuthMethod = "nip07" | "nsec" | "bunker" | "connect";

const METHODS: { value: AuthMethod; label: string }[] = [
  { value: "nip07", label: "NIP-07" },
  { value: "nsec", label: "Nsec" },
  { value: "bunker", label: "Bunker" },
  { value: "connect", label: "Nostr Connect" },
];

function MethodToggle({
  value,
  onChange,
}: {
  value: AuthMethod;
  onChange: (next: AuthMethod) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {METHODS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`px-3 py-1 text-[10px] font-semibold tracking-widest border rounded uppercase ${
            value === option.value
              ? "bg-zinc-800 border-zinc-600 text-white"
              : "bg-transparent border-zinc-700 text-zinc-400 hover:border-zinc-500"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function BunkerField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-xs text-zinc-300">
        Bunker URI
      </label>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="bunker://… or you@example.com"
        className="px-2 py-1 border dark:bg-zinc-800 dark:border-zinc-700 text-zinc-100 text-xs"
      />
      <p className="text-[10px] text-zinc-500">
        Paste the connection string from nsec.app, Amber, or nsecbunker. Your
        key never leaves the signer.
      </p>
    </div>
  );
}

// The nostrconnect:// URI is minted synchronously, so it can be shown (as a QR
// code in a real app) while we wait for the remote signer to reach back.
function ConnectUri({ uri }: { uri: string | null }) {
  if (!uri) {
    return (
      <p className="text-[10px] text-zinc-500">
        Starts a nostrconnect:// session and waits for a remote signer to
        approve it.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[10px] text-zinc-500">
        Scan or paste this into your signer, then approve:
      </p>
      <code className="text-[10px] text-emerald-400 break-all border dark:border-zinc-700 p-2">
        {uri}
      </code>
    </div>
  );
}

const openAuthUrl = (url: string) =>
  window.open(url, "_blank", "noopener,noreferrer");

const CLIENT_METADATA = {
  name: "better-auth-nostr example",
  url: typeof window !== "undefined" ? window.location.origin : undefined,
};

type Status = { ok: boolean; message: string } | null;

/**
 * Owns one panel's choice of signer. Sign-in and key-linking each get their
 * own instance, so a new auth method is wired here once rather than twice.
 */
function useSignerInput(defaultMethod: AuthMethod) {
  const [method, setMethod] = useState<AuthMethod>(defaultMethod);
  const [nsec, setNsec] = useState("");
  const [bunkerUri, setBunkerUri] = useState("");
  const [connectUri, setConnectUri] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>(null);

  /**
   * Resolves what to hand the auth client. A remote signer is a live relay
   * subscription, so the second element is the caller's to close.
   */
  const acquire = async (): Promise<
    [
      { nsec: string } | { signer: RemoteNostrSigner } | undefined,
      RemoteNostrSigner | null,
    ]
  > => {
    if (method === "nip07") return [undefined, null];
    if (method === "nsec") {
      if (!nsec.trim()) throw new Error("Enter an nsec first.");
      return [{ nsec }, null];
    }

    if (method === "bunker") {
      if (!bunkerUri.trim()) throw new Error("Enter a bunker URI first.");
      const signer = await createBunkerSigner(bunkerUri, {
        onAuthUrl: openAuthUrl,
        metadata: CLIENT_METADATA,
        timeoutMs: 120_000,
      });
      return [{ signer }, signer];
    }

    const session = createNostrConnectSession({
      metadata: CLIENT_METADATA,
      onAuthUrl: openAuthUrl,
    });
    setConnectUri(session.uri);
    try {
      const signer = await session.connect(120_000);
      return [{ signer }, signer];
    } finally {
      setConnectUri(null);
    }
  };

  /** Runs one auth action end to end, closing any signer it opened. */
  const submit = async (
    action: (source: any) => Promise<{ data: any; error: any }>,
    describe: (data: any) => string,
    onSuccess: () => void,
  ) => {
    setStatus(null);
    let opened: RemoteNostrSigner | null = null;
    try {
      if (method === "bunker" || method === "connect") {
        setStatus({ ok: true, message: "Waiting for the remote signer…" });
      }
      const [source, signer] = await acquire();
      opened = signer;

      const { data, error } = await action(source);
      if (error) {
        setStatus({ ok: false, message: formatError(error) });
        return;
      }
      setStatus({ ok: true, message: describe(data) });
      onSuccess();
    } catch (err) {
      setStatus({
        ok: false,
        message: err instanceof Error ? err.message : "Sign-in failed",
      });
    } finally {
      await opened?.close().catch(() => {});
    }
  };

  const fields = (
    <>
      <MethodToggle value={method} onChange={setMethod} />
      {method === "nsec" && (
        <NsecField
          id={`${defaultMethod}-nsec`}
          value={nsec}
          onChange={setNsec}
        />
      )}
      {method === "bunker" && (
        <BunkerField
          id={`${defaultMethod}-bunker`}
          value={bunkerUri}
          onChange={setBunkerUri}
        />
      )}
      {method === "connect" && <ConnectUri uri={connectUri} />}
    </>
  );

  return { method, status, submit, fields };
}

export default function Home() {
  const { data: session } = authClient.useSession();
  const { linked } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();

  const login = useSignerInput("nip07");
  const link = useSignerInput("nsec");
  const [linkName, setLinkName] = useState("");

  const handleLogin = () =>
    login.submit(
      (source) => authClient.signIn.nostr(source),
      (data) => `Signed in as ${data?.user.name}`,
      () => revalidator.revalidate(),
    );

  const handleAddPubkey = () =>
    link.submit(
      (source) =>
        authClient.nostr.addPubkey({
          ...(source ?? {}),
          ...(linkName.trim() ? { name: linkName.trim() } : {}),
        }),
      (data) => `Linked ${data?.pubkey.publicKey}`,
      () => revalidator.revalidate(),
    );

  const signOut = async () => {
    await authClient.signOut();
    revalidator.revalidate();
  };

  return (
    <div className="dark:bg-zinc-900 p-6 border dark:border-zinc-800 shadow-lg max-w-5xl min-w-sm flex flex-col gap-6">
      {session ? (
        <>
          <div className="flex flex-col gap-2">
            <h2 className="text-xs text-zinc-300">Session</h2>
            <div className="font-mono text-xs overflow-x-auto">
              <RecursiveEntry value={session} />
            </div>
            <Button
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={signOut}
            >
              Logout
            </Button>
          </div>

          <div className="flex flex-col gap-2 border-t dark:border-zinc-800 pt-4">
            <h2 className="text-xs text-zinc-300">
              Linked pubkeys ({linked.length})
            </h2>
            <ul className="font-mono text-[11px] text-zinc-400 flex flex-col gap-1">
              {linked.map((pubkey) => (
                <li key={pubkey.id} className="break-all">
                  {pubkey.publicKey}
                  {pubkey.name ? ` — ${pubkey.name}` : ""}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col gap-4 border-t dark:border-zinc-800 pt-4">
            <h2 className="text-xs text-zinc-300">Link another pubkey</h2>
            {link.fields}
            <div className="flex flex-col gap-2">
              <label htmlFor="link-name" className="text-xs text-zinc-300">
                Label (optional)
              </label>
              <input
                id="link-name"
                type="text"
                value={linkName}
                onChange={(event) => setLinkName(event.target.value)}
                placeholder="e.g. phone signer"
                className="px-2 py-1 border dark:bg-zinc-800 dark:border-zinc-700 text-zinc-100 text-xs"
              />
            </div>
            <Button
              type="button"
              onClick={handleAddPubkey}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
            >
              Link pubkey
            </Button>
            <Status status={link.status} />
          </div>
        </>
      ) : (
        <form className="flex flex-col gap-4">
          <h2 className="text-xs text-zinc-300">Login with Nostr</h2>
          {login.fields}
          <Button
            type="button"
            onClick={handleLogin}
            className="bg-blue-600 text-white hover:bg-blue-700"
          >
            Login with {METHODS.find((m) => m.value === login.method)?.label}
          </Button>
          <Status status={login.status} />
        </form>
      )}
    </div>
  );
}
