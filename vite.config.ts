import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// Mounts the news API on the dev server so `npm run dev` is the only command needed.
function newsApi(): Plugin {
  return {
    name: "prakash-news-api",
    async configureServer(server) {
      // @ts-expect-error plain ESM module without types
      const { handleApi, warmUp } = await import("./server/api.mjs");
      warmUp();
      server.middlewares.use((req, res, next) => {
        if ((req as { url?: string }).url?.startsWith("/api/")) return handleApi(req, res);
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), newsApi()],
  server: { port: 5173, watch: { ignored: ["**/.cache/**"] } },
  build: { chunkSizeWarningLimit: 1200 },
});
