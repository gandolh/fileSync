import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// Vite dev proxy → server's loopback UI listener.
// The bearer token lives in the dev process (.env.local: FILESYNC_SHARED_SECRET)
// and gets injected by the proxy so the browser never sees it.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = env.FILESYNC_UI_URL ?? "http://127.0.0.1:3001";
  const secret = env.FILESYNC_SHARED_SECRET ?? "";

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target,
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api/, ""),
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq) => {
              if (secret) proxyReq.setHeader("authorization", `Bearer ${secret}`);
            });
          },
        },
      },
    },
  };
});
