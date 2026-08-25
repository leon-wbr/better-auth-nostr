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

function MethodToggle({
  value,
  onChange,
}: {
  value: "nip07" | "nsec";
  onChange: (next: "nip07" | "nsec") => void;
}) {
  return (
    <div className="flex gap-2">
      {[
        { value: "nip07", label: "NIP-07" },
        { value: "nsec", label: "Nsec" },
      ].map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value as "nip07" | "nsec")}
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

export default function Home() {
  const { data: session } = authClient.useSession();
  const { linked } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();

  const [authMethod, setAuthMethod] = useState<"nip07" | "nsec">("nip07");
  const [nsec, setNsec] = useState("");
  const [signInStatus, setSignInStatus] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  const [linkMethod, setLinkMethod] = useState<"nip07" | "nsec">("nsec");
  const [linkNsec, setLinkNsec] = useState("");
  const [linkName, setLinkName] = useState("");
  const [linkStatus, setLinkStatus] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  const handleLogin = async () => {
    setSignInStatus(null);

    if (authMethod === "nsec" && nsec.trim() === "") {
      setSignInStatus({ ok: false, message: "Enter an nsec first." });
      return;
    }

    const { data, error } = await authClient.signIn.nostr(
      authMethod === "nsec" ? { nsec } : undefined,
    );

    if (error) {
      setSignInStatus({ ok: false, message: formatError(error) });
      return;
    }

    setSignInStatus({ ok: true, message: `Signed in as ${data?.user.name}` });
    revalidator.revalidate();
  };

  const handleAddPubkey = async () => {
    setLinkStatus(null);

    if (linkMethod === "nsec" && linkNsec.trim() === "") {
      setLinkStatus({ ok: false, message: "Enter an nsec first." });
      return;
    }

    const { data, error } = await authClient.nostr.addPubkey({
      ...(linkMethod === "nsec" ? { nsec: linkNsec } : {}),
      ...(linkName.trim() ? { name: linkName.trim() } : {}),
    });

    if (error) {
      setLinkStatus({ ok: false, message: formatError(error) });
      return;
    }

    setLinkStatus({ ok: true, message: `Linked ${data?.pubkey.publicKey}` });
    revalidator.revalidate();
  };

  const signOut = async () => {
    await authClient.signOut();
    setSignInStatus(null);
    setLinkStatus(null);
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
            <MethodToggle value={linkMethod} onChange={setLinkMethod} />
            {linkMethod === "nsec" && (
              <NsecField
                id="link-nsec"
                value={linkNsec}
                onChange={setLinkNsec}
              />
            )}
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
            <Status status={linkStatus} />
          </div>
        </>
      ) : (
        <form className="flex flex-col gap-4">
          <h2 className="text-xs text-zinc-300">Login with Nostr</h2>
          <MethodToggle value={authMethod} onChange={setAuthMethod} />
          {authMethod === "nsec" && (
            <NsecField id="nostr-nsec" value={nsec} onChange={setNsec} />
          )}
          <Button
            type="button"
            onClick={handleLogin}
            className="bg-blue-600 text-white hover:bg-blue-700"
          >
            Login with {authMethod === "nsec" ? "NSEC" : "NIP-07"}
          </Button>
          <Status status={signInStatus} />
        </form>
      )}
    </div>
  );
}
