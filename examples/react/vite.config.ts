import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  define: {
    "import.meta.env.VITE_AUTH_BASE_URL": JSON.stringify(
      process.env.BETTER_AUTH_URL ?? "http://localhost:5173",
    ),
    "import.meta.env.VITE_AUTH_BASE_PATH": JSON.stringify(
      process.env.AUTH_BASE_PATH ?? "/api/auth",
    ),
  },
  plugins: [tailwindcss(), reactRouter(), tsconfigPaths()],
});
