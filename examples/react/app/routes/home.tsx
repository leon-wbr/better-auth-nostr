import { useState } from "react";
import Button from "~/components/ui/Button";
import { authClient } from "~/lib/auth";

const isDate = (key: string): boolean =>
  ["createdAt", "expiresAt", "updatedAt"].some(
    (dateKey) => dateKey.toLowerCase() === key.toLowerCase()
  );

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
                typeof v !== "object" || v === null || isDate(k)
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

export default function Home() {
  const { data: session } = authClient.useSession();

  const [authMethod, setAuthMethod] = useState<"nip07" | "nsec">("nip07");
  const [nsec, setNsec] = useState("");

  const signIn = async () => {
    if (nsec.trim() === "") {
      alert("Please enter a valid NSEC key.");
      return;
    }

    await authClient.signIn.nostr({ nsec });
  };

  const signInWithNIP07 = async () => {
    await authClient.signIn.nostr();
  };

  const handleLogin = async () => {
    if (authMethod === "nsec") {
      await signIn();
      return;
    }

    await signInWithNIP07();
  };

  const signOut = async () => {
    await authClient.signOut();
  };

  return (
    <div className="dark:bg-zinc-900 p-6 border dark:border-zinc-800 shadow-lg max-w-5xl min-w-sm">
      {session ? (
        <div className="flex flex-col gap-2">
          <h2 className="text-xs text-zinc-300">Login with Nostr</h2>
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
      ) : (
        <form className="flex flex-col gap-4">
          <div className="flex gap-2">
            {[
              { value: "nip07", label: "NIP-07" },
              { value: "nsec", label: "Nsec" },
            ].map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => setAuthMethod(value as "nip07" | "nsec")}
                className={`px-3 py-1 text-[10px] font-semibold tracking-widest border rounded uppercase ${
                  authMethod === value
                    ? "bg-zinc-800 border-zinc-600 text-white"
                    : "bg-transparent border-zinc-700 text-zinc-400 hover:border-zinc-500"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {authMethod === "nsec" && (
            <div className="flex flex-col gap-2">
              <label htmlFor="nostr-nsec" className="text-xs text-zinc-300">
                Private key
              </label>
              <input
                id="nostr-nsec"
                type="text"
                value={nsec}
                onChange={(event) => setNsec(event.target.value)}
                placeholder="Enter your Nsec private key"
                className="px-2 py-1 border dark:bg-zinc-800 dark:border-zinc-700 text-zinc-100 text-xs uppercase"
              />
              <p className="text-[10px] text-zinc-500">
                Your key stays in the browser for this session.
              </p>
            </div>
          )}
          <Button
            type="button"
            onClick={handleLogin}
            className="bg-blue-600 text-white hover:bg-blue-700"
          >
            Login with {authMethod === "nsec" ? "NSEC" : "NIP-07"}
          </Button>
        </form>
      )}
    </div>
  );
}
