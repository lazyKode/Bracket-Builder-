import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "fs";
import { createHash } from "crypto";

// Three builds from the same client code:
//   vite build                                       -> dist/public  served by the Express server
//   VITE_BACKEND=local vite build                    -> dist/app     offline app, wrapped for iPhone (Capacitor)
//   VITE_BACKEND=local VITE_ROUTER=hash vite build   -> dist/web     offline app as a plain web page that can be
//                                                                    hosted anywhere (GitHub Pages) and installed
//                                                                    from the browser ("Add to Home Screen")
const offline = process.env.VITE_BACKEND === "local";
const web = offline && process.env.VITE_ROUTER === "hash";
const outDir = path.resolve(import.meta.dirname, web ? "dist/web" : offline ? "dist/app" : "dist/public");

/**
 * Writes sw.js after the web build: a service worker that stores every file
 * of the app on the device the first time it is opened, so it starts and
 * runs with no internet afterwards. The cache name changes whenever any file
 * changes, which is what makes a new version replace the old one.
 */
function offlineServiceWorker(): Plugin {
  return {
    name: "offline-service-worker",
    apply: "build",
    closeBundle() {
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else files.push(path.relative(outDir, full).split(path.sep).join("/"));
        }
      };
      walk(outDir);
      // .woff is only a fallback for very old browsers; everything current uses .woff2.
      const precache = files.filter(f => f !== "sw.js" && !f.endsWith(".woff")).sort();
      const hash = createHash("sha1");
      for (const f of precache) hash.update(f).update(fs.readFileSync(path.join(outDir, f)));
      const version = hash.digest("hex").slice(0, 12);
      const template = fs.readFileSync(path.resolve(import.meta.dirname, "client", "sw.template.js"), "utf8");
      fs.writeFileSync(
        path.join(outDir, "sw.js"),
        template.replace("__VERSION__", version).replace("__FILES__", JSON.stringify(precache)),
      );
      // Lets a static host open deep links before the service worker is installed.
      fs.copyFileSync(path.join(outDir, "index.html"), path.join(outDir, "404.html"));
      console.log(`offline service worker: ${precache.length} files, version ${version}`);
    },
  };
}

export default defineConfig({
  plugins: [react(), ...(web ? [offlineServiceWorker()] : [])],
  // Relative asset URLs so the web build works from any folder (e.g. /Bracket-Builder-/ on GitHub Pages).
  base: web ? "./" : "/",
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir,
    emptyOutDir: true,
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
