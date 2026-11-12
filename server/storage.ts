import { eq, and, asc, desc, inArray } from "drizzle-orm";
import { db, hasDatabase } from "./db";
import {
  users, tournaments, participants, matches, matchEvents,
  type User, type InsertUser,
  type Tournament, type InsertTournament,
  type Participant,
  type Match, type InsertMatch,
  type MatchEvent,
  type TournamentWithDetails,
  type WeightClass,
  weightClassLabel,
} from "@shared/schema";
import {
  hydrateTournament, pickMatchUpdates, sortMatches,
  type IStorage, type NewEvent, type NewParticipant, type ParticipantUpdate, type TournamentSettings,
} from "@shared/storage";
import { uid } from "@shared/id";
import { createFileStorage } from "./file-store";

export type { IStorage } from "@shared/storage";

export class DatabaseStorage implements IStorage {
  async getUser(id: string) {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string) {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = uid();
    const [user] = await db.insert(users).values({ ...insertUser, id }).returning();
    return user;
  }

  async getTournaments(userId?: string): Promise<Tournament[]> {
    let rows;
    if (userId) {
      rows = await db.select().from(tournaments).where(eq(tournaments.userId, userId)).orderBy(desc(tournaments.createdAt));
    } else {
      rows = await db.select().from(tournaments).orderBy(desc(tournaments.createdAt));
    }
    return rows.map(hydrateTournament);
  }

  async getTournament(id: string) {
    const [t] = await db.select().from(tournaments).where(eq(tournaments.id, id));
    if (!t) return undefined;
    return hydrateTournament(t);
  }

  async getTournamentByShareToken(token: string) {
    if (!token) return undefined;
    const [t] = await db.select().from(tournaments).where(eq(tournaments.shareToken, token));
    if (!t) return undefined;
    return hydrateTournament(t);
  }

  async getTournamentWithDetails(id: string): Promise<TournamentWithDetails | undefined> {
    const tournament = await this.getTournament(id);
    if (!tournament) return undefined;

    const parts = await db.select().from(participants)
      .where(eq(participants.tournamentId, id))
      .orderBy(asc(participants.seed));

    const matchRows = await db.select().from(matches)
      .where(eq(matches.tournamentId, id));

    return { ...tournament, participants: parts, matches: sortMatches(matchRows) };
  }

  async createTournament(data: InsertTournament, userId?: string): Promise<Tournament> {
    const id = uid();
    const wcs = data.weightClasses ?? [];
    const labels = wcs.map(wc => weightClassLabel(wc));

    const [t] = await db.insert(tournaments).values({
      id, name: data.name, size: data.size, status: "setup",
      weightCategories: labels,
      weightClassesJson: JSON.stringify(wcs),
      email: data.email || "",
      userId: userId || null,
    }).returning();

    return hydrateTournament(t);
  }

  async updateTournamentStatus(id: string, status: string) {
    const [t] = await db.update(tournaments).set({ status }).where(eq(tournaments.id, id)).returning();
    if (!t) return undefined;
    return hydrateTournament(t);
  }

  async updateTournamentWeightClasses(id: string, weightClasses: WeightClass[]) {
    const labels = weightClasses.map(wc => weightClassLabel(wc));
    const [t] = await db.update(tournaments).set({
      weightCategories: labels,
      weightClassesJson: JSON.stringify(weightClasses),
    }).where(eq(tournaments.id, id)).returning();
    if (!t) return undefined;
    return hydrateTournament(t);
  }

  async updateTournamentEmail(id: string, email: string) {
    const [t] = await db.update(tournaments).set({ email }).where(eq(tournaments.id, id)).returning();
    if (!t) return undefined;
    return hydrateTournament(t);
  }

  async updateTournamentSettings(id: string, settings: TournamentSettings) {
    const setObj: any = {};
    if (settings.tableCount !== undefined) setObj.tableCount = settings.tableCount;
    if (settings.autoTables !== undefined) setObj.autoTables = settings.autoTables;
    if (settings.seedingMode !== undefined) setObj.seedingMode = settings.seedingMode;
    if (settings.shareToken !== undefined) setObj.shareToken = settings.shareToken;
    if (Object.keys(setObj).length === 0) return this.getTournament(id);
    const [t] = await db.update(tournaments).set(setObj).where(eq(tournaments.id, id)).returning();
    if (!t) return undefined;
    return hydrateTournament(t);
  }

  async deleteTournament(id: string) {
    await db.delete(matchEvents).where(eq(matchEvents.tournamentId, id));
    await db.delete(matches).where(eq(matches.tournamentId, id));
    await db.delete(participants).where(eq(participants.tournamentId, id));
    await db.delete(tournaments).where(eq(tournaments.id, id));
  }

  async getParticipants(tournamentId: string) {
    return db.select().from(participants)
      .where(eq(participants.tournamentId, tournamentId))
      .orderBy(asc(participants.seed));
  }

  async addParticipant(data: NewParticipant): Promise<Participant> {
    const id = uid();
    const [p] = await db.insert(participants).values({
      id, tournamentId: data.tournamentId, name: data.name,
      seed: data.seed, weightCategory: data.weightCategory ?? null,
      club: data.club ?? null, athleteId: data.athleteId ?? null,
      photoUrl: data.photoUrl ?? null,
    }).returning();
    return p;
  }

  async getParticipant(id: string) {
    const [p] = await db.select().from(participants).where(eq(participants.id, id));
    return p;
  }

  async updateParticipant(id: string, updates: ParticipantUpdate) {
    const setObj: any = {};
    if (updates.name !== undefined) setObj.name = updates.name;
    if (updates.club !== undefined) setObj.club = updates.club;
    if (updates.seed !== undefined) setObj.seed = updates.seed;
    if (updates.photoUrl !== undefined) setObj.photoUrl = updates.photoUrl;
    if (updates.athleteId !== undefined) setObj.athleteId = updates.athleteId;
    if (Object.keys(setObj).length === 0) return this.getParticipant(id);
    const [p] = await db.update(participants).set(setObj).where(eq(participants.id, id)).returning();
    return p;
  }

  async updateParticipantPhoto(id: string, photoUrl: string | null) {
    const [p] = await db.update(participants).set({ photoUrl }).where(eq(participants.id, id)).returning();
    return p;
  }

  async deleteParticipant(id: string) {
    await db.delete(participants).where(eq(participants.id, id));
  }

  async getMatches(tournamentId: string) {
    return db.select().from(matches).where(eq(matches.tournamentId, tournamentId));
  }

  async getMatch(id: string) {
    const [m] = await db.select().from(matches).where(eq(matches.id, id));
    return m;
  }

  async createMatch(data: InsertMatch): Promise<Match> {
    const id = uid();
    const [m] = await db.insert(matches).values({
      id,
      tournamentId: data.tournamentId,
      bracket: data.bracket,
      round: data.round,
      matchIndex: data.matchIndex,
      participant1Id: data.participant1Id ?? null,
      participant2Id: data.participant2Id ?? null,
      winnerId: null,
      weightCategory: data.weightCategory ?? null,
    }).returning();
    return m;
  }

  async updateMatch(id: string, updates: Partial<Match>) {
    const setObj = pickMatchUpdates(updates);
    if (Object.keys(setObj).length === 0) return this.getMatch(id);
    const [m] = await db.update(matches).set(setObj).where(eq(matches.id, id)).returning();
    return m;
  }

  async setMatchWinner(matchId: string, winnerId: string) {
    return this.updateMatch(matchId, { winnerId });
  }

  async clearMatches(tournamentId: string) {
    await db.delete(matches).where(eq(matches.tournamentId, tournamentId));
  }

  async deleteMatchesByIds(ids: string[]) {
    if (ids.length === 0) return;
    await db.delete(matches).where(inArray(matches.id, ids));
  }

  async insertMatchRows(rows: Match[]) {
    if (rows.length === 0) return;
    await db.insert(matches).values(rows);
  }

  async findMatch(tournamentId: string, bracket: string, round: number, matchIndex: number, weightCategory?: string | null) {
    const conditions = [
      eq(matches.tournamentId, tournamentId),
      eq(matches.bracket, bracket),
      eq(matches.round, round),
      eq(matches.matchIndex, matchIndex),
    ];

    const rows = await db.select().from(matches).where(and(...conditions));
    if (weightCategory === undefined) return rows[0];
    return rows.find(m => m.weightCategory === weightCategory);
  }

  async getEventSummaries(tournamentId: string) {
    return db.select({
      id: matchEvents.id, tournamentId: matchEvents.tournamentId, scope: matchEvents.scope,
      seq: matchEvents.seq, kind: matchEvents.kind, matchId: matchEvents.matchId,
      summary: matchEvents.summary, createdAt: matchEvents.createdAt,
    }).from(matchEvents)
      .where(eq(matchEvents.tournamentId, tournamentId))
      .orderBy(asc(matchEvents.seq));
  }

  async getEvent(id: string) {
    const [e] = await db.select().from(matchEvents).where(eq(matchEvents.id, id));
    return e;
  }

  async createEvent(event: NewEvent): Promise<MatchEvent> {
    const [e] = await db.insert(matchEvents).values({ ...event, id: uid() }).returning();
    return e;
  }

  async deleteEvents(ids: string[]) {
    if (ids.length === 0) return;
    await db.delete(matchEvents).where(inArray(matchEvents.id, ids));
  }

  async clearEvents(tournamentId: string) {
    await db.delete(matchEvents).where(eq(matchEvents.tournamentId, tournamentId));
  }
}

// PostgreSQL when DATABASE_URL is set; otherwise everything is kept in memory
// and saved to a JSON file, so the server also works with no database at all.
export const storage: IStorage = hasDatabase ? new DatabaseStorage() : createFileStorage();
