// The offline backend: the same storage, operations and API handlers the
// server uses (shared/), running inside the app and saved on the device.
// Nothing here talks to the network.
import { MemStorage, type StorageDump } from "@shared/storage";
import { createOps } from "@shared/ops";
import { createApi } from "@shared/api";
import type { MatchEvent, User } from "@shared/schema";
import { readAll, writeBatch } from "./idb";

export const LOCAL_USER: User = { id: "local-organiser", username: "This device", password: "", email: "" };

// ---- saving to the device ---------------------------------------------------
// Keys:  users | tournaments | participants:<tid> | matches:<tid> | event:<tid>:<id>
// Only what changed is rewritten, so recording a result stays fast even with
// many tournaments and photos stored.

const dirty = new Set<string>();
const pendingEvents = new Map<string, MatchEvent>();
const pendingDeletes = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;
let saving: Promise<void> = Promise.resolve();
let lastError: unknown = null;
/** Event keys currently on the device, so a deleted tournament's undo history can be cleaned up. */
const knownEventKeys = new Set<string>();

function schedule() {
  if (!timer) timer = setTimeout(flush, 40);
}

function mark(key: string) {
  dirty.add(key);
  pendingDeletes.delete(key);
  schedule();
}

function remove(key: string) {
  dirty.delete(key);
  pendingEvents.delete(key);
  pendingDeletes.add(key);
  schedule();
}

const store = new MemStorage({
  usersChanged: () => mark("users"),
  tournamentsChanged: () => mark("tournaments"),
  participantsChanged: tid => mark(`participants:${tid}`),
  matchesChanged: tid => mark(`matches:${tid}`),
  eventSaved: e => {
    const key = `event:${e.tournamentId}:${e.id}`;
    pendingEvents.set(key, e);
    pendingDeletes.delete(key);
    schedule();
  },
  eventsDeleted: (tid, ids) => ids.forEach(id => remove(`event:${tid}:${id}`)),
  tournamentDeleted: tid => {
    remove(`participants:${tid}`);
    remove(`matches:${tid}`);
    // The store drops a deleted tournament's undo history without listing it, so clear it here.
    Array.from(knownEventKeys).filter(key => key.startsWith(`event:${tid}:`)).forEach(remove);
    Array.from(pendingEvents.keys()).filter(key => key.startsWith(`event:${tid}:`)).forEach(remove);
  },
});

function valueFor(key: string): unknown {
  if (key === "users") return store.userRows();
  if (key === "tournaments") return store.tournamentRows();
  const [kind, tid] = key.split(":");
  return kind === "participants" ? store.participantRows(tid) : store.matchRows(tid);
}

/** Write everything that is waiting. Returns once it is safely stored. */
export function flush(): Promise<void> {
  if (timer) { clearTimeout(timer); timer = null; }
  if (!dirty.size && !pendingEvents.size && !pendingDeletes.size) return saving;

  const puts = new Map<string, unknown>();
  dirty.forEach(key => puts.set(key, valueFor(key)));
  pendingEvents.forEach((e, key) => { puts.set(key, e); knownEventKeys.add(key); });
  const deletes = Array.from(pendingDeletes);
  deletes.forEach(key => knownEventKeys.delete(key));
  dirty.clear();
  pendingEvents.clear();
  pendingDeletes.clear();

  saving = saving
    .then(() => writeBatch(puts, deletes))
    .then(() => { lastError = null; })
    .catch(err => {
      lastError = err;
      console.error("Could not save to this device", err);
    });
  return saving;
}

if (typeof document !== "undefined") {
  // Leaving the app or switching away: save immediately rather than after the short delay.
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
  window.addEventListener("pagehide", () => { flush(); });
}

async function loadFromDevice() {
  const all = await readAll();
  const data: Partial<StorageDump> = { users: [], tournaments: [], participants: [], matches: [], events: [] };
  all.forEach((value, key) => {
    if (key === "users") data.users = value as StorageDump["users"];
    else if (key === "tournaments") data.tournaments = value as StorageDump["tournaments"];
    else if (key.startsWith("participants:")) data.participants!.push(...(value as StorageDump["participants"]));
    else if (key.startsWith("matches:")) data.matches!.push(...(value as StorageDump["matches"]));
    else if (key.startsWith("event:")) { data.events!.push(value as MatchEvent); knownEventKeys.add(key); }
  });
  store.load(data);
  store.ensureUser(LOCAL_USER);
  // Ask the system not to clear this app's data when storage runs low (best effort).
  navigator.storage?.persist?.().catch(() => {});
}

export const ready: Promise<void> = loadFromDevice();

// ---- live updates (same idea as the server's event stream, but in-process) ----

type Listener = { onUpdate: () => void; onClosed?: () => void };
const listeners = new Map<string, Set<Listener>>();

function notify(tournamentId: string, event: "update" | "closed" = "update") {
  listeners.get(tournamentId)?.forEach(l => (event === "closed" ? l.onClosed?.() : l.onUpdate()));
}

const ops = createOps({ storage: store, notify });
const api = createApi({ storage: store, ops });

/** `streamUrl` is the address the server version would open: /api/tournaments/:id/stream or /api/public/:token/stream. */
export function subscribe(streamUrl: string, onUpdate: () => void, onClosed?: () => void): () => void {
  const listener: Listener = { onUpdate, onClosed };
  let tournamentId: string | null = null;
  let cancelled = false;

  (async () => {
    await ready;
    const parts = streamUrl.split("/").filter(Boolean);
    if (parts[1] === "tournaments") tournamentId = parts[2];
    else if (parts[1] === "public") tournamentId = (await store.getTournamentByShareToken(decodeURIComponent(parts[2])))?.id ?? null;
    if (cancelled || !tournamentId) return;
    if (!listeners.has(tournamentId)) listeners.set(tournamentId, new Set());
    listeners.get(tournamentId)!.add(listener);
  })();

  return () => {
    cancelled = true;
    if (tournamentId) listeners.get(tournamentId)?.delete(listener);
  };
}

// ---- requests -------------------------------------------------------------------

const publicUser = ({ password, ...rest }: User) => rest;

export async function request(method: string, url: string, body?: unknown): Promise<{ status: number; json: unknown }> {
  await ready;
  const path = url.split("?")[0];

  // There are no accounts offline: this device is the organiser.
  if (path === "/api/user") return { status: 200, json: publicUser(LOCAL_USER) };
  if (path.startsWith("/api/auth/")) return { status: 200, json: publicUser(LOCAL_USER) };

  const out = await api.handle({ method, path, body, userId: LOCAL_USER.id });
  if (!out) return { status: 404, json: { message: "Not available in the offline app" } };
  return out;
}

// ---- backup ----------------------------------------------------------------------

export interface BackupFile extends StorageDump {
  app: "bracket-builder";
  savedAt: string;
}

export async function exportBackup(): Promise<BackupFile> {
  await ready;
  await flush();
  return { app: "bracket-builder", savedAt: new Date().toISOString(), ...store.dump() };
}

/** Replace everything on this device with the contents of a backup file. */
export async function importBackup(text: string): Promise<{ tournaments: number; athletes: number }> {
  await ready;
  let data: BackupFile;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("That file is not a Bracket Builder backup");
  }
  if (data?.app !== "bracket-builder" || !Array.isArray(data.tournaments) || !Array.isArray(data.matches)) {
    throw new Error("That file is not a Bracket Builder backup");
  }
  // Tournaments made on the server version belong to another account id; adopt them.
  const tournaments = data.tournaments.map(t => ({ ...t, userId: LOCAL_USER.id, shareToken: null }));
  store.load({ ...data, users: [LOCAL_USER], tournaments });

  // Rewrite the device copy from scratch in one transaction.
  if (timer) { clearTimeout(timer); timer = null; }
  dirty.clear(); pendingEvents.clear(); pendingDeletes.clear(); knownEventKeys.clear();
  const puts = new Map<string, unknown>();
  puts.set("users", store.userRows());
  puts.set("tournaments", store.tournamentRows());
  for (const t of store.tournamentRows()) {
    puts.set(`participants:${t.id}`, store.participantRows(t.id));
    puts.set(`matches:${t.id}`, store.matchRows(t.id));
  }
  for (const e of store.eventRows()) {
    const key = `event:${e.tournamentId}:${e.id}`;
    puts.set(key, e);
    knownEventKeys.add(key);
  }
  await saving;
  await writeBatch(puts, [], true);
  return { tournaments: tournaments.length, athletes: (data.participants ?? []).length };
}

export function saveError(): unknown {
  return lastError;
}
