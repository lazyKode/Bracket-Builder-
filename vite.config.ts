import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// Two builds from the same client code:
//   vite build                      -> dist/public  (served by the Express server)
//   VITE_BACKEND=local vite build   -> dist/app     (self-contained offline app, wrapped for iPhone)
const offline = process.env.VITE_BACKEND === "local";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, offline ? "dist/app" : "dist/public"),
    emptyOutDir: true,
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
