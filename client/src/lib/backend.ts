// One place that decides where requests go:
//   - server build (default): real HTTP requests to the Express server
//   - offline build (VITE_BACKEND=local): the backend bundled inside the app
// The rest of the client just calls apiFetch() and never needs to know.

export const IS_LOCAL = import.meta.env.VITE_BACKEND === "local";

// Loaded only in the offline build, so the server build does not carry it.
const local = IS_LOCAL ? import("@/local/backend") : null;

export async function apiFetch(method: string, url: string, body?: unknown): Promise<Response> {
  if (local) {
    const out = await (await local).request(method, url, body);
    return new Response(JSON.stringify(out.json), { status: out.status, headers: { "Content-Type": "application/json" } });
  }
  return fetch(url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: "include",
  });
}

/** Offline counterpart of the server's live-update stream. Returns an unsubscribe function. */
export function subscribeLocal(streamUrl: string, onUpdate: () => void, onClosed?: () => void): () => void {
  let unsubscribe: (() => void) | null = null;
  let cancelled = false;
  local?.then(backend => {
    if (!cancelled) unsubscribe = backend.subscribe(streamUrl, onUpdate, onClosed);
  });
  return () => {
    cancelled = true;
    unsubscribe?.();
  };
}

export async function localBackend() {
  if (!local) throw new Error("Only available in the offline app");
  return local;
}
