// Tournament operations: everything that changes a bracket goes through here
// so that undo, table assignment and live updates all agree.
//
// Platform-neutral: `createOps` is given a storage and a "something changed"
// callback, so the same code runs on the server (database + live streams) and
// inside the offline app (on-device storage).
import type { Match, Participant, Tournament, MatchEventSummary } from "./schema";
import type { IStorage } from "./storage";
import { MAX_TABLES, SCOPE_COC, SCOPE_DEFAULT } from "./constants";
import { seedingModeEnum } from "./validation";
import { randomToken, uid } from "./id";
import {
  BracketEngine, COC, bracketSizeFor, buildSlots, generateDoubleElimination,
  generateSingleElimination, isStandardDoubleElim, nextPowerOf2, type MatchDef,
} from "./bracket";
import {
  athleteKey, getCategoryChampion, getOverallChampionId, isCategoryComplete,
  isReadyMatch, matchesInScope, roundLabel, scopeOfMatch,
} from "./stats";

export class OpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const MAX_EVENTS_PER_SCOPE = 40;

export const LEGACY_BRACKET_MESSAGE =
  "This bracket was created with the old bracket format, which could drop players after one loss. " +
  "Restart this category to regenerate it with the corrected format.";

const TRACKED_FIELDS = [
  "participant1Id", "participant2Id", "winnerId", "participant1Fouls", "participant2Fouls",
  "matchNumber", "tableNumber", "winMethod", "readyAt", "completedAt",
] as const;

function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) {
    return (a ? new Date(a as any).getTime() : null) === (b ? new Date(b as any).getTime() : null);
  }
  return (a ?? null) === (b ?? null);
}

export interface BulkEntry { name: string; club?: string | null }

export interface OpsDeps {
  storage: IStorage;
  /** Called after every change so open screens can refresh. */
  notify: (tournamentId: string, event?: "update" | "closed") => void;
}

export type Ops = ReturnType<typeof createOps>;

export function createOps({ storage, notify }: OpsDeps) {
  /** Write only the rows/fields that differ from `before`. */
  async function persistMatches(before: Match[], after: Match[]) {
    const original = new Map(before.map(m => [m.id, m]));
    for (const m of after) {
      const old = original.get(m.id);
      if (!old) continue;
      const updates: Partial<Match> = {};
      for (const f of TRACKED_FIELDS) {
        if (!sameValue(old[f], m[f])) (updates as any)[f] = m[f];
      }
      if (Object.keys(updates).length) await storage.updateMatch(m.id, updates);
    }
  }

  const clone = (rows: Match[]): Match[] => rows.map(r => ({ ...r }));

  function newMatchRows(defs: MatchDef[]): Match[] {
    return defs.map(d => ({
      id: uid(),
      tournamentId: d.tournamentId, bracket: d.bracket, round: d.round, matchIndex: d.matchIndex,
      participant1Id: d.participant1Id, participant2Id: d.participant2Id, winnerId: null,
      weightCategory: d.weightCategory, participant1Fouls: 0, participant2Fouls: 0,
      matchNumber: null, tableNumber: null, winMethod: null, readyAt: null, completedAt: null,
    }));
  }

  async function requireTournament(tid: string): Promise<Tournament> {
    const t = await storage.getTournament(tid);
    if (!t) throw new OpError(404, "Tournament not found");
    return t;
  }

  // ---- Status ------------------------------------------------------------------

  /**
   * Derives the tournament status from its brackets:
   *   setup -> active -> awaiting_coc -> finals -> completed
   * "awaiting_coc" means every bracket that has been started is finished and the
   * organiser decides what happens next (start remaining classes, hold the
   * Champion of Champions, or end the tournament).
   */
  async function refreshStatus(tid: string): Promise<string> {
    const t = await requireTournament(tid);
    const matches = await storage.getMatches(tid);
    const categories = t.weightCategories ?? [];
    let next: string;

    if (matches.length === 0) {
      next = "setup";
    } else if (matches.some(m => m.bracket === COC)) {
      next = getOverallChampionId(matches) ? "completed" : "finals";
    } else if (categories.length === 0) {
      next = isCategoryComplete(matches, null) ? "completed" : "active";
    } else {
      const started = categories.filter(c => matches.some(m => m.weightCategory === c));
      const allStartedDone = started.length > 0 && started.every(c => isCategoryComplete(matches, c));
      if (!allStartedDone) {
        next = "active";
      } else if (started.length === categories.length && started.length < 2) {
        next = "completed";
      } else {
        next = t.status === "completed" ? "completed" : "awaiting_coc";
      }
    }

    if (next !== t.status) await storage.updateTournamentStatus(tid, next);
    return next;
  }

  // ---- Match numbers and tables -----------------------------------------------

  const BRACKET_ORDER: Record<string, number> = { winners: 0, losers: 1, grand_final: 2, [COC]: 3 };

  /**
   * Keeps the call sheet consistent after any change:
   *  - gives each match a call number the moment both players are known,
   *  - frees a table when its match is decided,
   *  - (auto mode) sends the next ready match to each free table, never calling
   *    an athlete who is already competing on another table.
   */
  async function syncMatchMeta(tid: string): Promise<void> {
    const t = await requireTournament(tid);
    const before = await storage.getMatches(tid);
    const matches = clone(before);
    const participants = await storage.getParticipants(tid);
    const byId = new Map(participants.map(p => [p.id, p]));
    const categories = t.weightCategories ?? [];
    const now = new Date();

    for (const m of matches) {
      if (m.winnerId) {
        if (!m.completedAt) m.completedAt = now;
        if (m.tableNumber != null) m.tableNumber = null;
      } else if (!isReadyMatch(m)) {
        if (m.tableNumber != null) m.tableNumber = null;
      }
    }

    const ready = matches.filter(isReadyMatch);
    let nextNumber = Math.max(0, ...matches.map(m => m.matchNumber ?? 0)) + 1;
    const unnumbered = ready.filter(m => m.matchNumber == null).sort((a, b) =>
      categories.indexOf(a.weightCategory ?? "") - categories.indexOf(b.weightCategory ?? "") ||
      (BRACKET_ORDER[a.bracket] ?? 9) - (BRACKET_ORDER[b.bracket] ?? 9) ||
      a.round - b.round || a.matchIndex - b.matchIndex);
    for (const m of unnumbered) {
      m.matchNumber = nextNumber++;
      m.readyAt = now;
    }

    const live = t.status === "active" || t.status === "finals";
    const tableCount = Math.min(MAX_TABLES, Math.max(1, t.tableCount ?? 1));
    const byNumber = [...ready].sort((a, b) => (a.matchNumber ?? 0) - (b.matchNumber ?? 0));

    // One match per table, and no table numbers beyond the configured count.
    const taken = new Set<number>();
    for (const m of byNumber) {
      if (m.tableNumber == null) continue;
      if (!live || m.tableNumber > tableCount || taken.has(m.tableNumber)) m.tableNumber = null;
      else taken.add(m.tableNumber);
    }

    if (live && t.autoTables) {
      const keyOf = (pid: string | null) => athleteKey(byId.get(pid ?? ""), pid);
      const busy = new Set<string>();
      for (const m of byNumber) {
        if (m.tableNumber != null) { busy.add(keyOf(m.participant1Id)); busy.add(keyOf(m.participant2Id)); }
      }
      for (let table = 1; table <= tableCount; table++) {
        if (taken.has(table)) continue;
        const candidate = byNumber.find(m =>
          m.tableNumber == null && !busy.has(keyOf(m.participant1Id)) && !busy.has(keyOf(m.participant2Id)));
        if (!candidate) break;
        candidate.tableNumber = table;
        taken.add(table);
        busy.add(keyOf(candidate.participant1Id));
        busy.add(keyOf(candidate.participant2Id));
      }
    }

    await persistMatches(before, matches);
  }

  async function finish(tid: string): Promise<string> {
    const status = await refreshStatus(tid);
    await syncMatchMeta(tid);
    notify(tid);
    return status;
  }

  // ---- Event log (undo) ---------------------------------------------------------

  async function pushEvent(tid: string, scope: string, kind: string, matchId: string | null, summary: string, rowsBefore: Match[]) {
    const existing = await storage.getEventSummaries(tid);
    const seq = (existing.length ? existing[existing.length - 1].seq : 0) + 1;
    await storage.createEvent({ tournamentId: tid, scope, seq, kind, matchId, summary, snapshot: JSON.stringify(rowsBefore) });
    const inScope = existing.filter(e => e.scope === scope);
    const excess = inScope.length + 1 - MAX_EVENTS_PER_SCOPE;
    if (excess > 0) await storage.deleteEvents(inScope.slice(0, excess).map(e => e.id));
  }

  function reviveSnapshot(json: string): Match[] {
    const rows = JSON.parse(json) as any[];
    return rows.map(r => ({
      ...r,
      readyAt: r.readyAt ? new Date(r.readyAt) : null,
      completedAt: r.completedAt ? new Date(r.completedAt) : null,
    }));
  }

  async function listEvents(tid: string): Promise<MatchEventSummary[]> {
    return (await storage.getEventSummaries(tid)).reverse();
  }

  /**
   * Rewind one bracket to the moment just before `eventId` was recorded. Later
   * results in the same bracket are discarded with it; other brackets are untouched.
   */
  async function undoTo(tid: string, eventId: string): Promise<void> {
    const event = await storage.getEvent(eventId);
    if (!event || event.tournamentId !== tid) throw new OpError(404, "That result is no longer in the undo history");

    const summaries = await storage.getEventSummaries(tid);
    const all = await storage.getMatches(tid);
    const cocMatches = all.filter(m => m.bracket === COC);

    if (event.scope !== SCOPE_COC && cocMatches.length) {
      if (summaries.some(e => e.scope === SCOPE_COC)) {
        throw new OpError(400, "Undo the Champion of Champions results first");
      }
      // CoC was drawn but nothing played yet: its line-up depends on this bracket, so drop it.
      await storage.deleteMatchesByIds(cocMatches.map(m => m.id));
    }

    await storage.deleteMatchesByIds(matchesInScope(all, event.scope).map(m => m.id));
    await storage.insertMatchRows(reviveSnapshot(event.snapshot));
    await storage.deleteEvents(summaries.filter(e => e.scope === event.scope && e.seq >= event.seq).map(e => e.id));
    await finish(tid);
  }

  async function undoLast(tid: string, scope: string): Promise<void> {
    const inScope = (await storage.getEventSummaries(tid)).filter(e => e.scope === scope);
    if (!inScope.length) throw new OpError(400, "Nothing to undo in this bracket");
    await undoTo(tid, inScope[inScope.length - 1].id);
  }

  // ---- Starting brackets --------------------------------------------------------

  async function startCategory(
    tid: string, category: string | null,
    opts: { byeRecipientId?: string | null; random?: () => number } = {},
  ): Promise<void> {
    const t = await requireTournament(tid);
    const hasCategories = (t.weightCategories ?? []).length > 0;
    if (hasCategories && (!category || !t.weightCategories!.includes(category))) {
      throw new OpError(400, "Invalid weight category");
    }
    if (!hasCategories && category) throw new OpError(400, "This tournament has no weight categories");
    if (t.status === "finals" || t.status === "completed") throw new OpError(400, "Cannot start categories in current state");

    const scope = category ?? SCOPE_DEFAULT;
    const existing = await storage.getMatches(tid);
    if (matchesInScope(existing, scope).length) {
      throw new OpError(400, category ? `Category "${category}" already started` : "Tournament already started");
    }

    const entrants = (await storage.getParticipants(tid)).filter(p => (category ? p.weightCategory === category : true));
    if (entrants.length < 2) {
      throw new OpError(400, category ? `Need at least 2 participants in "${category}"` : "Need at least 2 participants");
    }

    const mode = seedingModeEnum.catch("sequential").parse(t.seedingMode);
    const size = bracketSizeFor(entrants.length);
    const slots = buildSlots(entrants.map(p => p.id), size, mode, opts);
    const rows = newMatchRows(generateDoubleElimination(tid, slots, size, category));
    new BracketEngine(rows).settleByes();
    await storage.insertMatchRows(rows);
    await finish(tid);
  }

  async function startCoc(tid: string, byeRecipientId?: string | null): Promise<void> {
    const t = await requireTournament(tid);
    if (t.status !== "awaiting_coc") throw new OpError(400, "Tournament is not awaiting Champion of Champions decision");
    const matches = await storage.getMatches(tid);
    const champions = (t.weightCategories ?? [])
      .map(cat => getCategoryChampion(matches, cat))
      .filter((id): id is string => !!id);
    if (champions.length < 2) throw new OpError(400, "Champion of Champions needs at least 2 category champions");

    const size = nextPowerOf2(champions.length);
    const slots = buildSlots(champions, size, "sequential", { byeRecipientId });
    const rows = newMatchRows(generateSingleElimination(tid, slots, size));
    new BracketEngine(rows).settleByes();
    await storage.insertMatchRows(rows);
    await finish(tid);
  }

  async function skipCoc(tid: string): Promise<void> {
    const t = await requireTournament(tid);
    if (t.status !== "awaiting_coc") throw new OpError(400, "Tournament is not awaiting Champion of Champions decision");
    await storage.updateTournamentStatus(tid, "completed");
    await syncMatchMeta(tid);
    notify(tid);
  }

  async function resetTournament(tid: string): Promise<void> {
    await storage.clearMatches(tid);
    await storage.clearEvents(tid);
    await storage.updateTournamentStatus(tid, "setup");
    notify(tid);
  }

  /** Throw away one category's bracket (and its undo history) so it can be drawn again. */
  async function restartCategory(tid: string, category: string | null): Promise<void> {
    const scope = category ?? SCOPE_DEFAULT;
    const all = await storage.getMatches(tid);
    const rows = matchesInScope(all, scope);
    if (!rows.length) throw new OpError(400, "This category has not been started");

    const summaries = await storage.getEventSummaries(tid);
    const cocMatches = all.filter(m => m.bracket === COC);
    if (cocMatches.length && summaries.some(e => e.scope === SCOPE_COC)) {
      throw new OpError(400, "Undo the Champion of Champions results first");
    }
    await storage.deleteMatchesByIds([...rows, ...cocMatches].map(m => m.id));
    await storage.deleteEvents(summaries.filter(e => e.scope === scope || e.scope === SCOPE_COC).map(e => e.id));
    const t = await requireTournament(tid);
    if (t.status === "completed") await storage.updateTournamentStatus(tid, "active");
    await finish(tid);
  }

  // ---- Results ---------------------------------------------------------------------

  interface ResultOutcome { status: string; completedNow: boolean; decided: boolean }

  async function loadPlayableMatch(matchId: string) {
    const match = await storage.getMatch(matchId);
    if (!match) throw new OpError(404, "Match not found");
    const tournament = await requireTournament(match.tournamentId);
    return { match, tournament };
  }

  function assertPlayable(match: Match, tournament: Tournament) {
    if (tournament.status !== "active" && tournament.status !== "finals") throw new OpError(400, "Tournament is not active");
    if (match.winnerId) throw new OpError(400, "Match already decided");
    if (!match.participant1Id || !match.participant2Id) throw new OpError(400, "Both participants must be set");
  }

  function describe(match: Match, scopeRows: Match[], text: string): string {
    const number = match.matchNumber != null ? `#${match.matchNumber} · ` : "";
    return `${number}${roundLabel(match, scopeRows)} · ${text}`;
  }

  async function applyResult(
    match: Match, tournament: Tournament, kind: "winner" | "foul",
    summaryText: (names: (id: string | null) => string) => string,
    mutate: (engine: BracketEngine, row: Match) => void,
  ): Promise<ResultOutcome> {
    const tid = tournament.id;
    const scope = scopeOfMatch(match);
    const all = await storage.getMatches(tid);
    const before = matchesInScope(all, scope);
    if (scope !== SCOPE_COC && !isStandardDoubleElim(before)) throw new OpError(409, LEGACY_BRACKET_MESSAGE);

    // Apply in memory first so a rejected result leaves no trace in the undo history.
    const rows = clone(before);
    const engine = new BracketEngine(rows);
    const row = rows.find(r => r.id === match.id)!;
    mutate(engine, row);

    const participants = await storage.getParticipants(tid);
    const nameOf = (id: string | null) => participants.find(p => p.id === id)?.name ?? "Unknown";
    await pushEvent(tid, scope, kind, match.id, describe(match, before, summaryText(nameOf)), before);
    await persistMatches(before, rows);

    const status = await finish(tid);
    return { status, completedNow: status === "completed" && tournament.status !== "completed", decided: !!row.winnerId };
  }

  async function recordWinner(matchId: string, winnerId: string): Promise<ResultOutcome> {
    const { match, tournament } = await loadPlayableMatch(matchId);
    assertPlayable(match, tournament);
    if (winnerId !== match.participant1Id && winnerId !== match.participant2Id) {
      throw new OpError(400, "Winner must be a participant of this match");
    }
    const loserId = winnerId === match.participant1Id ? match.participant2Id : match.participant1Id;
    return applyResult(match, tournament, "winner",
      name => `${name(winnerId)} def. ${name(loserId)}`,
      engine => engine.decide(match.id, winnerId, "pin"));
  }

  async function recordFoul(matchId: string, participantId: string): Promise<ResultOutcome> {
    const { match, tournament } = await loadPlayableMatch(matchId);
    assertPlayable(match, tournament);
    if (participantId !== match.participant1Id && participantId !== match.participant2Id) {
      throw new OpError(400, "Participant must be in this match");
    }
    const isP1 = participantId === match.participant1Id;
    const fouls = (isP1 ? match.participant1Fouls : match.participant2Fouls) + 1;
    const opponentId = isP1 ? match.participant2Id! : match.participant1Id!;
    return applyResult(match, tournament, "foul",
      name => fouls >= 2
        ? `${name(participantId)} disqualified on fouls — ${name(opponentId)} wins`
        : `Foul on ${name(participantId)} (1 of 2)`,
      (engine, row) => {
        if (isP1) row.participant1Fouls = fouls; else row.participant2Fouls = fouls;
        if (fouls >= 2) engine.decide(match.id, opponentId, "fouls");
      });
  }

  // ---- Tables, settings, sharing ------------------------------------------------

  async function setMatchTable(matchId: string, tableNumber: number | null): Promise<void> {
    const { match, tournament } = await loadPlayableMatch(matchId);
    assertPlayable(match, tournament);
    if (tableNumber != null) {
      if (!Number.isInteger(tableNumber) || tableNumber < 1 || tableNumber > tournament.tableCount) {
        throw new OpError(400, `Table must be between 1 and ${tournament.tableCount}`);
      }
      // Whatever is on that table goes back to the queue.
      const all = await storage.getMatches(tournament.id);
      for (const other of all) {
        if (other.id !== match.id && !other.winnerId && other.tableNumber === tableNumber) {
          await storage.updateMatch(other.id, { tableNumber: null });
        }
      }
    }
    await storage.updateMatch(match.id, { tableNumber });
    await syncMatchMeta(tournament.id);
    notify(tournament.id);
  }

  async function updateSettings(
    tid: string, settings: { tableCount?: number; autoTables?: boolean; seedingMode?: string },
  ): Promise<void> {
    await requireTournament(tid);
    await storage.updateTournamentSettings(tid, settings);
    await syncMatchMeta(tid);
    notify(tid);
  }

  async function setSharing(tid: string, enabled: boolean): Promise<string | null> {
    const t = await requireTournament(tid);
    if (enabled && t.shareToken) return t.shareToken;
    const token = enabled ? randomToken() : null;
    await storage.updateTournamentSettings(tid, { shareToken: token });
    if (!enabled) notify(tid, "closed");
    return token;
  }

  // ---- Participants ---------------------------------------------------------------

  function categoryStarted(matches: Match[], category: string | null): boolean {
    return matchesInScope(matches, category ?? SCOPE_DEFAULT).length > 0;
  }

  /** Renumber seeds 1..n in the current order (after a delete or a manual reorder). */
  async function renumberSeeds(tid: string, category: string | null, orderedIds?: string[]): Promise<void> {
    const entrants = (await storage.getParticipants(tid)).filter(p => (category ? p.weightCategory === category : true));
    let ordered: Participant[] = entrants;
    if (orderedIds) {
      const rank = new Map(orderedIds.map((id, i) => [id, i]));
      ordered = [...entrants].sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9) || a.seed - b.seed);
    }
    for (let i = 0; i < ordered.length; i++) {
      if (ordered[i].seed !== i + 1) await storage.updateParticipant(ordered[i].id, { seed: i + 1 });
    }
  }

  /** Entries of the same person in other classes (left/right hand, extra weight class). */
  async function linkedEntries(p: Participant): Promise<Participant[]> {
    if (!p.athleteId) return [p];
    return (await storage.getParticipants(p.tournamentId)).filter(x => x.athleteId === p.athleteId);
  }


  /**
   * Add many athletes at once, each to one or more classes. An athlete entered
   * in several classes gets linked entries so edits and scheduling treat them
   * as one person. Names already present in a class are skipped.
   */
  async function addAthletes(
    tid: string, entries: BulkEntry[], categories: (string | null)[],
    opts: { allowDuplicateNames?: boolean } = {},
  ): Promise<{ added: number; skipped: number }> {
    const t = await requireTournament(tid);
    if (t.status === "finals" || t.status === "completed") throw new OpError(400, "Cannot modify after bracket is completed");
    const hasCategories = (t.weightCategories ?? []).length > 0;
    const targets = hasCategories ? categories : [null];
    if (!targets.length) throw new OpError(400, "Choose at least one weight class");

    const matches = await storage.getMatches(tid);
    for (const cat of targets) {
      if (hasCategories && (!cat || !t.weightCategories!.includes(cat))) throw new OpError(400, "Invalid weight category");
      if (categoryStarted(matches, cat)) {
        throw new OpError(400, cat ? `"${cat}" has already started` : "Cannot modify after bracket is started");
      }
    }

    const existing = await storage.getParticipants(tid);
    const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
    const counts = new Map<string | null, number>();
    const names = new Map<string | null, Set<string>>();
    for (const cat of targets) {
      const inCat = existing.filter(p => (cat ? p.weightCategory === cat : true));
      counts.set(cat, inCat.length);
      names.set(cat, new Set(inCat.map(p => norm(p.name))));
    }

    let added = 0;
    let skipped = 0;
    for (const entry of entries) {
      const name = entry.name.trim().replace(/\s+/g, " ");
      if (!name) continue;
      const club = entry.club?.trim() || null;
      const open = targets.filter(cat =>
        (opts.allowDuplicateNames || !names.get(cat)!.has(norm(name))) && counts.get(cat)! < t.size);
      skipped += targets.length - open.length;
      if (!open.length) continue;

      // Reuse the link if this person is already entered in another class.
      const known = existing.find(p => norm(p.name) === norm(name));
      let athleteId = known?.athleteId ?? null;
      if (!athleteId && (open.length > 1 || known)) {
        athleteId = uid();
        if (known) {
          for (const p of existing.filter(x => norm(x.name) === norm(name))) {
            await storage.updateParticipant(p.id, { athleteId });
            p.athleteId = athleteId;
          }
        }
      }

      for (const cat of open) {
        const seed = counts.get(cat)! + 1;
        const created = await storage.addParticipant({
          tournamentId: tid, name, seed, weightCategory: cat,
          club: club ?? known?.club ?? null, athleteId, photoUrl: known?.photoUrl ?? null,
        });
        existing.push(created);
        counts.set(cat, seed);
        names.get(cat)!.add(norm(name));
        added++;
      }
    }
    notify(tid);
    return { added, skipped };
  }

  return {
    refreshStatus,
    syncMatchMeta,
    listEvents,
    undoTo,
    undoLast,
    startCategory,
    startCoc,
    skipCoc,
    resetTournament,
    restartCategory,
    recordWinner,
    recordFoul,
    setMatchTable,
    updateSettings,
    setSharing,
    categoryStarted,
    renumberSeeds,
    linkedEntries,
    addAthletes,
  };
}
