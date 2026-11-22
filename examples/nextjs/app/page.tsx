import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { SignIn } from "./sign-in";

export default async function Home() {
  const session = await auth.api.getSession({ headers: await headers() });
  return (
    <main>
      <h1>Sign in with Nostr</h1>
      <p>
        On the server, the session belongs to{" "}
        <code>{session ? session.user.name : "nobody"}</code>.
      </p>
      <SignIn />
    </main>
  );
}
