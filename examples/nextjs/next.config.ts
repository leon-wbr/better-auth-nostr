import type { NextConfig } from "next";

const config: NextConfig = {
  // The client signs against this URL and the server checks signatures
  // against it, so both read the same variable.
  env: { NEXT_PUBLIC_BETTER_AUTH_URL: process.env.BETTER_AUTH_URL },
};

export default config;
