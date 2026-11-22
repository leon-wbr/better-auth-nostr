import { createAuthClient } from "better-auth/client";
import { nostrClient } from "better-auth-nostr/client";
import { generateSecretKey, nip19 } from "nostr-tools";

const authClient = createAuthClient({
  baseURL: location.origin,
  plugins: [nostrClient()],
});

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const status = $("status");
const nsec = $<HTMLInputElement>("nsec");

const render = async () => {
  const { data } = await authClient.getSession();
  status.textContent = data ? `Signed in as ${data.user.name}` : "Signed out";
  $("signed-in").hidden = !data;
  $("signed-out").hidden = Boolean(data);
};

const signIn = async (source?: { nsec: string }) => {
  const { error } = await authClient.signIn.nostr(source);
  $("error").textContent = error ? (error.message ?? error.code ?? "") : "";
  await render();
};

$("extension").onclick = () => signIn();
$("generate").onclick = () => {
  nsec.value = nip19.nsecEncode(generateSecretKey());
};
$("with-nsec").onclick = () => signIn({ nsec: nsec.value });
$("sign-out").onclick = async () => {
  await authClient.signOut();
  await render();
};

await render();
