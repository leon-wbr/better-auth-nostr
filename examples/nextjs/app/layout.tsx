import type { ReactNode } from "react";

export const metadata = { title: "better-auth-nostr · Next.js" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{ fontFamily: "system-ui", maxWidth: 640, margin: "2rem auto" }}
      >
        {children}
      </body>
    </html>
  );
}
