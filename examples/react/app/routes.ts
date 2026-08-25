import { index, type RouteConfig, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("api/auth/*", "routes/api.auth.$.ts"),
  // Second mount point so AUTH_BASE_PATH=/auth works without editing routes.
  route("auth/*", "routes/api.auth.$.ts", { id: "auth-alt" }),
] satisfies RouteConfig;
