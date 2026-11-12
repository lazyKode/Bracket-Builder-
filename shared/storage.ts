// Storage contract shared by every backend, plus the in-memory implementation.
//
//  - Server with PostgreSQL  -> DatabaseStorage (server/storage.ts)
//  - Server without database -> MemStorage saved to a JSON file
//  - Offline app (iPhone)    -> MemStorage saved to the device (IndexedDB)
//
// MemStorage itself only keeps things in memory; whoever creates it can pass
// `hooks` to be told what changed and persist it wherever suits the platform.
import type {
  User, InsertUser, Tournament, Participant, InsertParticipant,
  Match, InsertMatch, MatchEvent, MatchEventSummary, TournamentWithDetails,
} from "./schema";
import { weightClassLabel, type InsertTournament, type WeightClass } from "./validation";
import { COC } from "./bracket";
import { uid } from "./id";

export type TournamentSettings = Partial<Pick<Tournament, "tableCount" | "autoTables" | "seedingMode" | "shareToken">>;
export type ParticipantUpdate = Partial<Pick<Participant, "name" | "club" | "seed" | "photoUrl" | "athleteId">>;
export type NewParticipant = InsertParticipant & { club?: string | null; athleteId?: string | null; photoUrl?: string | null };
export type NewEvent = Pick<MatchEvent, "tournamentId" | "scope" | "seq" | "kind" | "matchId" | "summary" | "snapshot">;

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  getTournaments(userId?: string): Promise<Tournament[]>;
  getTournament(id: string): Promise<Tournament | undefined>;
  getTournamentByShareToken(token: string): Promise<Tournament | undefined>;
  getTournamentWithDetails(id: string): Promise<TournamentWithDetails | undefined>;
  createTournament(tournament: InsertTournament, userId?: string): Promise<Tournament>;
  updateTournamentStatus(id: string, status: string): Promise<Tournament | undefined>;
  updateTournamentWeightClasses(id: string, weightClasses: WeightClass[]): Promise<Tournament | undefined>;
  updateTournamentEmail(id: string, email: string): Promise<Tournament | undefined>;
  updateTournamentSettings(id: string, settings: TournamentSettings): Promise<Tournament | undefined>;
  deleteTournament(id: string): Promise<void>;

  getParticipants(tournamentId: string): Promise<Participant[]>;
  getParticipant(id: string): Promise<Participant | undefined>;
  addParticipant(participant: NewParticipant): Promise<Participant>;
  updateParticipant(id: string, updates: ParticipantUpdate): Promise<Participant | undefined>;
  updateParticipantPhoto(id: string, photoUrl: string | null): Promise<Participant | undefined>;
  deleteParticipant(id: string): Promise<void>;

  getMatches(tournamentId: string): Promise<Match[]>;
  getMatch(id: string): Promise<Match | undefined>;
  createMatch(match: InsertMatch): Promise<Match>;
  updateMatch(id: string, updates: Partial<Match>): Promise<Match | undefined>;
  setMatchWinner(matchId: string, winnerId: string): Promise<Match | undefined>;
  clearMatches(tournamentId: string): Promise<void>;
  deleteMatchesByIds(ids: string[]): Promise<void>;
  insertMatchRows(rows: Match[]): Promise<void>;
  findMatch(tournamentId: string, bracket: string, round: number, matchIndex: number, weightCategory?: string | null): Promise<Match | undefined>;

  /** Event log without the (large) snapshots, oldest first. */
  getEventSummaries(tournamentId: string): Promise<MatchEventSummary[]>;
  getEvent(id: string): Promise<MatchEvent | undefined>;
  createEvent(event: NewEvent): Promise<MatchEvent>;
  deleteEvents(ids: string[]): Promise<void>;
  clearEvents(tournamentId: string): Promise<void>;
}

const BRACKET_ORDER: Record<string, number> = { winners: 0, losers: 1, grand_final: 2, [COC]: 3 };

export function sortMatches(rows: Match[]): Match[] {
  return rows.sort((a, b) => {
    const bo = (BRACKET_ORDER[a.bracket] ?? 99) - (BRACKET_ORDER[b.bracket] ?? 99);
    if (bo !== 0) return bo;
    return a.round - b.round || a.matchIndex - b.matchIndex;
  });
}

/** A tournament as stored (weight classes kept as JSON text, like the database row). */
export type TournamentRow = Omit<Tournament, "weightClasses">;

export function hydrateTournament(t: TournamentRow): Tournament {
  let wcs: WeightClass[] = [];
  try {
    wcs = JSON.parse(t.weightClassesJson || "[]");
  } catch {}
  return { ...t, weightClasses: wcs };
}

export const MATCH_FIELDS = [
  "participant1Id", "participant2Id", "winnerId", "participant1Fouls", "participant2Fouls",
  "matchNumber", "tableNumber", "winMethod", "readyAt", "completedAt",
] as const;

export function pickMatchUpdates(updates: Partial<Match>): Partial<Match> {
  const out: any = {};
  for (const key of MATCH_FIELDS) {
    if (updates[key] !== undefined) out[key] = updates[key];
  }
  return out;
}

/** Everything a MemStorage holds; also the format of backup files. */
export interface StorageDump {
  version: 1;
  users: User[];
  tournaments: TournamentRow[];
  participants: Participant[];
  matches: Match[];
  events: MatchEvent[];
}

/** Notifications for whoever persists a MemStorage. All optional. */
export interface StorageHooks {
  usersChanged?(): void;
  tournamentsChanged?(): void;
  participantsChanged?(tournamentId: string): void;
  matchesChanged?(tournamentId: string): void;
  eventSaved?(event: MatchEvent): void;
  eventsDeleted?(tournamentId: string, ids: string[]): void;
  tournamentDeleted?(tournamentId: string): void;
  /** The whole content was replaced (restore from backup). */
  replaced?(): void;
}

const asDate = (v: unknown): Date | null => (v ? new Date(v as any) : null);

export class MemStorage implements IStorage {
  private users = new Map<string, User>();
  private tournaments = new Map<string, TournamentRow>();
  private participants = new Map<string, Participant>();
  private matches = new Map<string, Match>();
  private events = new Map<string, MatchEvent>();

  constructor(private hooks: StorageHooks = {}) {}

  // ---- persistence helpers ---------------------------------------------------

  dump(): StorageDump {
    return {
      version: 1,
      users: Array.from(this.users.values()),
      tournaments: Array.from(this.tournaments.values()),
      participants: Array.from(this.participants.values()),
      matches: Array.from(this.matches.values()),
      events: Array.from(this.events.values()),
    };
  }

  /** Replace everything (loading saved data at start-up, or restoring a backup). Dates may arrive as strings. */
  load(data: Partial<StorageDump>, notify = false) {
    this.users = new Map((data.users ?? []).map(u => [u.id, { ...u }]));
    this.tournaments = new Map((data.tournaments ?? []).map(t => [t.id, { ...t, createdAt: asDate(t.createdAt) ?? new Date() }]));
    this.participants = new Map((data.participants ?? []).map(p => [p.id, { ...p }]));
    this.matches = new Map((data.matches ?? []).map(m => [m.id, { ...m, readyAt: asDate(m.readyAt), completedAt: asDate(m.completedAt) }]));
    this.events = new Map((data.events ?? []).map(e => [e.id, { ...e, createdAt: asDate(e.createdAt) ?? new Date() }]));
    if (notify) this.hooks.replaced?.();
  }

  tournamentRows(): TournamentRow[] { return Array.from(this.tournaments.values()); }
  userRows(): User[] { return Array.from(this.users.values()); }
  participantRows(tournamentId: string): Participant[] {
    return Array.from(this.participants.values()).filter(p => p.tournamentId === tournamentId);
  }
  matchRows(tournamentId: string): Match[] {
    return Array.from(this.matches.values()).filter(m => m.tournamentId === tournamentId);
  }
  eventRows(): MatchEvent[] { return Array.from(this.events.values()); }

  // ---- users -------------------------------------------------------------------

  async getUser(id: string) { return this.users.get(id); }

  async getUserByUsername(username: string) {
    return Array.from(this.users.values()).find(u => u.username === username);
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const user: User = { id: uid(), username: insertUser.username, password: insertUser.password, email: insertUser.email ?? "" };
    this.users.set(user.id, user);
    this.hooks.usersChanged?.();
    return user;
  }

  /** Make sure a user with this id exists (the offline app has one built-in organiser). */
  ensureUser(user: User) {
    if (this.users.has(user.id)) return;
    this.users.set(user.id, user);
    this.hooks.usersChanged?.();
  }

  // ---- tournaments -------------------------------------------------------------

  async getTournaments(userId?: string) {
    return Array.from(this.tournaments.values())
      .filter(t => !userId || t.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map(hydrateTournament);
  }

  async getTournament(id: string) {
    const t = this.tournaments.get(id);
    return t ? hydrateTournament(t) : undefined;
  }

  async getTournamentByShareToken(token: string) {
    if (!token) return undefined;
    const t = Array.from(this.tournaments.values()).find(x => x.shareToken === token);
    return t ? hydrateTournament(t) : undefined;
  }

  async getTournamentWithDetails(id: string): Promise<TournamentWithDetails | undefined> {
    const tournament = await this.getTournament(id);
    if (!tournament) return undefined;
    return {
      ...tournament,
      participants: await this.getParticipants(id),
      matches: sortMatches(await this.getMatches(id)),
    };
  }

  async createTournament(data: InsertTournament, userId?: string): Promise<Tournament> {
    const wcs = data.weightClasses ?? [];
    const row: TournamentRow = {
      id: uid(), name: data.name, size: data.size, status: "setup",
      weightCategories: wcs.map(wc => weightClassLabel(wc)),
      weightClassesJson: JSON.stringify(wcs),
      email: data.email || "",
      userId: userId || null,
      createdAt: new Date(),
      shareToken: null, tableCount: 1, autoTables: true, seedingMode: "sequential",
    };
    this.tournaments.set(row.id, row);
    this.hooks.tournamentsChanged?.();
    return hydrateTournament(row);
  }

  private patchTournament(id: string, patch: Partial<TournamentRow>) {
    const t = this.tournaments.get(id);
    if (!t) return undefined;
    const next = { ...t, ...patch };
    this.tournaments.set(id, next);
    this.hooks.tournamentsChanged?.();
    return hydrateTournament(next);
  }

  async updateTournamentStatus(id: string, status: string) { return this.patchTournament(id, { status }); }

  async updateTournamentWeightClasses(id: string, weightClasses: WeightClass[]) {
    return this.patchTournament(id, {
      weightCategories: weightClasses.map(wc => weightClassLabel(wc)),
      weightClassesJson: JSON.stringify(weightClasses),
    });
  }

  async updateTournamentEmail(id: string, email: string) { return this.patchTournament(id, { email }); }

  async updateTournamentSettings(id: string, settings: TournamentSettings) {
    const patch: any = {};
    for (const key of ["tableCount", "autoTables", "seedingMode", "shareToken"] as const) {
      if (settings[key] !== undefined) patch[key] = settings[key];
    }
    return this.patchTournament(id, patch);
  }

  async deleteTournament(id: string) {
    for (const e of Array.from(this.events.values())) if (e.tournamentId === id) this.events.delete(e.id);
    for (const m of Array.from(this.matches.values())) if (m.tournamentId === id) this.matches.delete(m.id);
    for (const p of Array.from(this.participants.values())) if (p.tournamentId === id) this.participants.delete(p.id);
    this.tournaments.delete(id);
    this.hooks.tournamentDeleted?.(id);
    this.hooks.tournamentsChanged?.();
  }

  // ---- participants ------------------------------------------------------------

  async getParticipants(tournamentId: string) {
    return this.participantRows(tournamentId).sort((a, b) => a.seed - b.seed).map(p => ({ ...p }));
  }

  async getParticipant(id: string) {
    const p = this.participants.get(id);
    return p ? { ...p } : undefined;
  }

  async addParticipant(data: NewParticipant): Promise<Participant> {
    const p: Participant = {
      id: uid(), tournamentId: data.tournamentId, name: data.name, seed: data.seed,
      weightCategory: data.weightCategory ?? null, photoUrl: data.photoUrl ?? null,
      club: data.club ?? null, athleteId: data.athleteId ?? null,
    };
    this.participants.set(p.id, p);
    this.hooks.participantsChanged?.(p.tournamentId);
    return { ...p };
  }

  async updateParticipant(id: string, updates: ParticipantUpdate) {
    const p = this.participants.get(id);
    if (!p) return undefined;
    for (const key of ["name", "club", "seed", "photoUrl", "athleteId"] as const) {
      if (updates[key] !== undefined) (p as any)[key] = updates[key];
    }
    this.hooks.participantsChanged?.(p.tournamentId);
    return { ...p };
  }

  async updateParticipantPhoto(id: string, photoUrl: string | null) {
    return this.updateParticipant(id, { photoUrl });
  }

  async deleteParticipant(id: string) {
    const p = this.participants.get(id);
    if (!p) return;
    this.participants.delete(id);
    this.hooks.participantsChanged?.(p.tournamentId);
  }

  // ---- matches -----------------------------------------------------------------

  async getMatches(tournamentId: string) {
    return this.matchRows(tournamentId).map(m => ({ ...m }));
  }

  async getMatch(id: string) {
    const m = this.matches.get(id);
    return m ? { ...m } : undefined;
  }

  async createMatch(data: InsertMatch): Promise<Match> {
    const m: Match = {
      id: uid(), tournamentId: data.tournamentId, bracket: data.bracket,
      round: data.round, matchIndex: data.matchIndex,
      participant1Id: data.participant1Id ?? null, participant2Id: data.participant2Id ?? null,
      winnerId: null, weightCategory: data.weightCategory ?? null,
      participant1Fouls: 0, participant2Fouls: 0,
      matchNumber: null, tableNumber: null, winMethod: null, readyAt: null, completedAt: null,
    };
    this.matches.set(m.id, m);
    this.hooks.matchesChanged?.(m.tournamentId);
    return { ...m };
  }

  async updateMatch(id: string, updates: Partial<Match>) {
    const m = this.matches.get(id);
    if (!m) return undefined;
    Object.assign(m, pickMatchUpdates(updates));
    this.hooks.matchesChanged?.(m.tournamentId);
    return { ...m };
  }

  async setMatchWinner(matchId: string, winnerId: string) { return this.updateMatch(matchId, { winnerId }); }

  async clearMatches(tournamentId: string) {
    for (const m of Array.from(this.matches.values())) {
      if (m.tournamentId === tournamentId) this.matches.delete(m.id);
    }
    this.hooks.matchesChanged?.(tournamentId);
  }

  async deleteMatchesByIds(ids: string[]) {
    const touched = new Set<string>();
    for (const id of ids) {
      const m = this.matches.get(id);
      if (!m) continue;
      touched.add(m.tournamentId);
      this.matches.delete(id);
    }
    for (const tid of Array.from(touched)) this.hooks.matchesChanged?.(tid);
  }

  async insertMatchRows(rows: Match[]) {
    const touched = new Set<string>();
    for (const r of rows) {
      this.matches.set(r.id, { ...r });
      touched.add(r.tournamentId);
    }
    for (const tid of Array.from(touched)) this.hooks.matchesChanged?.(tid);
  }

  async findMatch(tournamentId: string, bracket: string, round: number, matchIndex: number, weightCategory?: string | null) {
    const rows = this.matchRows(tournamentId).filter(m => m.bracket === bracket && m.round === round && m.matchIndex === matchIndex);
    const found = weightCategory === undefined ? rows[0] : rows.find(m => m.weightCategory === weightCategory);
    return found ? { ...found } : undefined;
  }

  // ---- event log ---------------------------------------------------------------

  async getEventSummaries(tournamentId: string) {
    return Array.from(this.events.values())
      .filter(e => e.tournamentId === tournamentId)
      .sort((a, b) => a.seq - b.seq)
      .map(({ snapshot, ...rest }) => rest);
  }

  async getEvent(id: string) { return this.events.get(id); }

  async createEvent(event: NewEvent): Promise<MatchEvent> {
    const e: MatchEvent = { ...event, id: uid(), createdAt: new Date() };
    this.events.set(e.id, e);
    this.hooks.eventSaved?.(e);
    return e;
  }

  async deleteEvents(ids: string[]) {
    const byTournament = new Map<string, string[]>();
    for (const id of ids) {
      const e = this.events.get(id);
      if (!e) continue;
      this.events.delete(id);
      byTournament.set(e.tournamentId, [...(byTournament.get(e.tournamentId) ?? []), id]);
    }
    for (const [tid, deleted] of Array.from(byTournament)) this.hooks.eventsDeleted?.(tid, deleted);
  }

  async clearEvents(tournamentId: string) {
    const ids = Array.from(this.events.values()).filter(e => e.tournamentId === tournamentId).map(e => e.id);
    await this.deleteEvents(ids);
  }
}
