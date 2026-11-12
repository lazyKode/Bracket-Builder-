// State of the on-device copy of the web app (service worker), for the
// installable web version only.
import { useSyncExternalStore } from "react";
import { IS_WEB_APP } from "./backend";

/** preparing = still being stored; ready = works offline; update = a newer version is downloaded and waiting. */
export type OfflineCopy = "unsupported" | "preparing" | "ready" | "update";

let state: OfflineCopy = "unsupported";
let waiting: ServiceWorker | null = null;
const listeners = new Set<() => void>();

function set(next: OfflineCopy) {
  if (state === next) return;
  state = next;
  listeners.forEach(l => l());
}

function watch(registration: ServiceWorkerRegistration) {
  const check = () => {
    if (registration.waiting && navigator.serviceWorker.controller) {
      waiting = registration.waiting;
      set("update");
    } else if (registration.active) {
      set("ready");
    }
  };
  check();
  registration.addEventListener("updatefound", () => {
    const worker = registration.installing;
    worker?.addEventListener("statechange", check);
  });
}

export function startOfflineCopy() {
  if (!IS_WEB_APP || !import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  set("preparing");
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js")
      .then(registration => {
        watch(registration);
        navigator.serviceWorker.ready.then(() => { if (state === "preparing") set("ready"); });
        // Look for a newer version each time the app is opened with a connection.
        registration.update().catch(() => {});
      })
      .catch(err => {
        console.warn("Offline copy could not be set up", err);
        set("unsupported");
      });
  });
}

/** Switch to the downloaded newer version (reloads the page; saved tournaments are not affected). */
export function installUpdate() {
  if (!waiting) return;
  navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload(), { once: true });
  waiting.postMessage("activate-now");
}

export function useOfflineCopy(): OfflineCopy {
  return useSyncExternalStore(
    callback => { listeners.add(callback); return () => listeners.delete(callback); },
    () => state,
  );
}
