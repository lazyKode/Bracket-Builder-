// Live updates over Server-Sent Events. Every open tournament page (organiser
// or spectator) holds one connection; when anything changes the server sends a
// small "update" ping and the page refetches. No extra dependency needed.
import type { Response } from "express";

const subscribers = new Map<string, Set<Response>>();
const spectators = new WeakSet<Response>();

export function subscribe(tournamentId: string, res: Response, kind: "organiser" | "spectator" = "organiser") {
  if (kind === "spectator") spectators.add(res);
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write("retry: 3000\n\n");
  res.write("event: hello\ndata: {}\n\n");

  let set = subscribers.get(tournamentId);
  if (!set) { set = new Set(); subscribers.set(tournamentId, set); }
  set.add(res);

  const heartbeat = setInterval(() => { res.write(": ping\n\n"); }, 25000);
  res.on("close", () => {
    clearInterval(heartbeat);
    set!.delete(res);
    if (set!.size === 0) subscribers.delete(tournamentId);
  });
}

export function notify(tournamentId: string, event: "update" | "closed" = "update") {
  const set = subscribers.get(tournamentId);
  if (!set) return;
  for (const res of Array.from(set)) {
    res.write(`event: ${event}\ndata: ${Date.now()}\n\n`);
  }
}

/** Spectator pages currently connected (the organiser's own screens are not counted). */
export function viewerCount(tournamentId: string): number {
  let count = 0;
  for (const res of Array.from(subscribers.get(tournamentId) ?? [])) {
    if (spectators.has(res)) count++;
  }
  return count;
}
