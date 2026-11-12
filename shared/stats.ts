// Rankings, records, team points, the call queue and cross-tournament athlete
// history. Pure functions shared by the server, the organiser UI and the
// public spectator page so that every screen shows the same numbers.

import type { Match, Participant, TournamentWithDetails } from "./schema";
import { SCOPE_COC, SCOPE_DEFAULT } from "./constants";
import { BracketEngine, COC, isStandardDoubleElim } from "./bracket";

type Details = Pick<TournamentWithDetails, "matches" | "participants" | "weightCategories" | "status" | "tableCount">;

export function scopeOfMatch(m: Match): string {
  if (m.bracket === COC) return SCOPE_COC;
  return m.weightCategory ?? SCOPE_DEFAULT;
}

export function matchesInScope(matches: Match[], scope: string): Match[] {
  return matches.filter(m => scopeOfMatch(m) === scope);
}

export function categoryMatches(matches: Match[], category: string | null): Match[] {
  return matchesInScope(matches, category ?? SCOPE_DEFAULT);
}

export function scopeLabel(scope: string): string {
  if (scope === SCOPE_COC) return "Champion of Champions";
  if (scope === SCOPE_DEFAULT) return "Bracket";
  return scope;
}

/** Compact label for tight spaces: "60kg - Seniors - Men - Right Hand" -> "60kg Men Right". */
export function shortCategory(category: string | null | undefined): string {
  if (!category) return "";
  const parts = category.split(" - ");
  if (parts.length < 4) return category;
  return `${parts[0]} ${parts[2]} ${parts[3].replace(" Hand", "")}`;
}

export function isRealMatch(m: Match): boolean {
  return !!m.participant1Id && !!m.participant2Id;
}

export function isByeMatch(m: Match): boolean {
  return !!m.winnerId && !isRealMatch(m);
}

export function isReadyMatch(m: Match): boolean {
  return !m.winnerId && isRealMatch(m);
}

export function isCategoryComplete(matches: Match[], category: string | null): boolean {
  return getCategoryChampion(matches, category) !== null;
}

export function getCategoryChampion(matches: Match[], category: string | null): string | null {
  const gfs = categoryMatches(matches, category).filter(m => m.bracket === "grand_final");
  const gf1 = gfs.find(m => m.round === 1);
  const gf2 = gfs.find(m => m.round === 2);
  if (!gf1?.winnerId) return null;
  if (gf1.winnerId === gf1.participant1Id) return gf1.winnerId;
  return gf2?.winnerId ?? null;
}

export function getOverallChampionId(matches: Match[]): string | null {
  const coc = matches.filter(m => m.bracket === COC);
  if (!coc.length) return null;
  const maxRound = Math.max(...coc.map(m => m.round));
  return coc.find(m => m.round === maxRound && m.matchIndex === 0)?.winnerId ?? null;
}

export interface PlayerRecord { wins: number; losses: number; fouls: number; byes: number }

/** Win-loss record over the given matches (byes are counted separately, not as wins). */
export function playerRecord(matches: Match[], participantId: string): PlayerRecord {
  const rec: PlayerRecord = { wins: 0, losses: 0, fouls: 0, byes: 0 };
  for (const m of matches) {
    const isP1 = m.participant1Id === participantId;
    const isP2 = m.participant2Id === participantId;
    if (!isP1 && !isP2) continue;
    rec.fouls += isP1 ? (m.participant1Fouls || 0) : (m.participant2Fouls || 0);
    if (!m.winnerId) continue;
    if (!isRealMatch(m)) { rec.byes++; continue; }
    if (m.winnerId === participantId) rec.wins++; else rec.losses++;
  }
  return rec;
}

export interface RankingRow extends PlayerRecord {
  participantId: string;
  rank: number;
  name: string;
  club: string | null;
}

/**
 * Final placings for one category: champion, runner-up, then players in the
 * order they went out of the losers bracket (players eliminated in the same
 * round share a place). Empty until the grand final is decided.
 */
export function computeCategoryRankings(matches: Match[], participants: Participant[], category: string | null): RankingRow[] {
  const catMatches = categoryMatches(matches, category);
  const catParticipants = category ? participants.filter(p => p.weightCategory === category) : participants;

  const gf1 = catMatches.find(m => m.bracket === "grand_final" && m.round === 1);
  const gf2 = catMatches.find(m => m.bracket === "grand_final" && m.round === 2);
  const champion = getCategoryChampion(matches, category);
  if (!gf1 || !champion) return [];

  const deciding = gf2?.winnerId ? gf2 : gf1;
  const runnerUp = champion === deciding.participant1Id ? deciding.participant2Id : deciding.participant1Id;

  const ranked: RankingRow[] = [];
  const placed = new Set<string>();
  const add = (pid: string | null | undefined, rank: number) => {
    if (!pid || placed.has(pid)) return;
    const p = catParticipants.find(pp => pp.id === pid);
    if (!p) return;
    placed.add(pid);
    ranked.push({ participantId: pid, rank, name: p.name, club: p.club ?? null, ...playerRecord(catMatches, pid) });
  };

  add(champion, 1);
  add(runnerUp, 2);

  const losers = catMatches.filter(m => m.bracket === "losers");
  const rounds = Array.from(new Set(losers.map(m => m.round))).sort((a, b) => b - a);
  let rank = 3;
  for (const round of rounds) {
    const out: string[] = [];
    for (const m of losers.filter(x => x.round === round)) {
      if (!m.winnerId || !isRealMatch(m)) continue;
      const loser = m.winnerId === m.participant1Id ? m.participant2Id : m.participant1Id;
      if (loser && !placed.has(loser)) out.push(loser);
    }
    for (const pid of out) add(pid, rank);
    rank += out.length;
  }

  // Anyone left (only possible in brackets made by the old engine) shares last place.
  const leftovers = catParticipants.filter(p => !placed.has(p.id));
  for (const p of leftovers) add(p.id, rank);

  return ranked.sort((a, b) => a.rank - b.rank);
}

export function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  const suffix = ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
}

// ---- Team (club) standings -------------------------------------------------

/** Points for places 1-6 in each category. */
export const TEAM_POINTS = [10, 7, 5, 3, 2, 1];

export interface TeamRow { club: string; points: number; gold: number; silver: number; bronze: number; entries: number }

export function computeTeamStandings(t: Details): TeamRow[] {
  const rows = new Map<string, TeamRow>();
  const row = (club: string) => {
    const k = club.trim();
    const found = Array.from(rows.values()).find(r => r.club.toLowerCase() === k.toLowerCase());
    if (found) return found;
    const created: TeamRow = { club: k, points: 0, gold: 0, silver: 0, bronze: 0, entries: 0 };
    rows.set(k, created);
    return created;
  };
  for (const p of t.participants) if (p.club?.trim()) row(p.club).entries++;

  const categories: (string | null)[] = t.weightCategories?.length ? t.weightCategories : [null];
  for (const cat of categories) {
    for (const r of computeCategoryRankings(t.matches, t.participants, cat)) {
      if (!r.club?.trim()) continue;
      const team = row(r.club);
      team.points += TEAM_POINTS[r.rank - 1] ?? 0;
      if (r.rank === 1) team.gold++;
      if (r.rank === 2) team.silver++;
      if (r.rank === 3) team.bronze++;
    }
  }
  return Array.from(rows.values()).sort((a, b) =>
    b.points - a.points || b.gold - a.gold || b.silver - a.silver || b.bronze - a.bronze || a.club.localeCompare(b.club));
}

// ---- Round names -------------------------------------------------------------

export function roundLabel(m: Match, scopeMatches: Match[]): string {
  const sameBracket = scopeMatches.filter(x => x.bracket === m.bracket);
  const maxRound = Math.max(...sameBracket.map(x => x.round));
  const count = sameBracket.filter(x => x.round === m.round).length;
  if (m.bracket === "grand_final") return m.round === 1 ? "Grand Final" : "Grand Final (reset)";
  if (m.bracket === COC) {
    if (m.round === maxRound) return "CoC Final";
    if (count === 2) return "CoC Semis";
    if (count === 4) return "CoC Quarters";
    return `CoC Round ${m.round}`;
  }
  if (m.bracket === "winners") {
    if (m.round === maxRound) return "Winners Final";
    if (count === 2) return "Winners Semis";
    if (count === 4) return "Winners Quarters";
    return `Winners R${m.round}`;
  }
  if (m.round === maxRound) return "Losers Final";
  return `Losers R${m.round}`;
}

// ---- Tables and the call queue ----------------------------------------------

export function athleteKey(p: Participant | undefined | null, fallbackId?: string | null): string {
  return p?.athleteId || p?.id || fallbackId || "";
}

export interface QueueItem {
  match: Match;
  p1: Participant | null;
  p2: Participant | null;
  roundLabel: string;
  category: string | null;
  /** An athlete in this match is competing on another table right now. */
  waitingOnAthlete: boolean;
}

export interface CallQueue {
  tables: { table: number; item: QueueItem | null }[];
  upNext: QueueItem[];
}

export function buildQueue(t: Details): CallQueue {
  const byId = new Map(t.participants.map(p => [p.id, p]));
  const scopeCache = new Map<string, Match[]>();
  const scopeOf = (m: Match) => {
    const s = scopeOfMatch(m);
    if (!scopeCache.has(s)) scopeCache.set(s, matchesInScope(t.matches, s));
    return scopeCache.get(s)!;
  };

  const ready = t.matches.filter(isReadyMatch);
  const onTable = ready.filter(m => m.tableNumber != null);
  const busy = new Set<string>();
  for (const m of onTable) {
    busy.add(athleteKey(byId.get(m.participant1Id!), m.participant1Id));
    busy.add(athleteKey(byId.get(m.participant2Id!), m.participant2Id));
  }

  const toItem = (m: Match): QueueItem => {
    const p1 = byId.get(m.participant1Id!) ?? null;
    const p2 = byId.get(m.participant2Id!) ?? null;
    return {
      match: m, p1, p2,
      roundLabel: roundLabel(m, scopeOf(m)),
      category: m.bracket === COC ? "Champion of Champions" : m.weightCategory,
      waitingOnAthlete: m.tableNumber == null &&
        (busy.has(athleteKey(p1, m.participant1Id)) || busy.has(athleteKey(p2, m.participant2Id))),
    };
  };

  const tableCount = Math.max(1, t.tableCount ?? 1);
  const tables = Array.from({ length: tableCount }, (_, i) => {
    const m = onTable.find(x => x.tableNumber === i + 1);
    return { table: i + 1, item: m ? toItem(m) : null };
  });
  const upNext = ready
    .filter(m => m.tableNumber == null)
    .sort((a, b) => (a.matchNumber ?? 1e9) - (b.matchNumber ?? 1e9))
    .map(toItem);
  return { tables, upNext };
}

/** Latest decided real matches, newest first. */
export function recentResults(t: Details, limit = 8): QueueItem[] {
  const byId = new Map(t.participants.map(p => [p.id, p]));
  return t.matches
    .filter(m => m.winnerId && isRealMatch(m))
    .sort((a, b) => new Date(b.completedAt ?? 0).getTime() - new Date(a.completedAt ?? 0).getTime()
      || (b.matchNumber ?? 0) - (a.matchNumber ?? 0))
    .slice(0, limit)
    .map(m => ({
      match: m,
      p1: byId.get(m.participant1Id!) ?? null,
      p2: byId.get(m.participant2Id!) ?? null,
      roundLabel: roundLabel(m, matchesInScope(t.matches, scopeOfMatch(m))),
      category: m.bracket === COC ? "Champion of Champions" : m.weightCategory,
      waitingOnAthlete: false,
    }));
}

/** Matches that should be drawn: everything except slots nobody can ever reach. */
export function visibleMatches(scopeMatches: Match[]): Match[] {
  const isCoc = scopeMatches.some(m => m.bracket === COC);
  if (!isCoc && !isStandardDoubleElim(scopeMatches)) {
    // Bracket from the old engine: fall back to hiding untouched matches.
    return scopeMatches.filter(m => m.participant1Id || m.participant2Id || m.winnerId || (m.bracket === "winners" && m.round === 1));
  }
  const engine = new BracketEngine(scopeMatches);
  return scopeMatches.filter(m => !engine.isDead(m));
}

/** Real matches played so far and the total that will be played (excluding a possible grand-final reset). */
export function progress(t: Details): { played: number; total: number } {
  let played = 0;
  let remaining = 0;
  for (const scope of Array.from(new Set(t.matches.map(scopeOfMatch)))) {
    const ms = matchesInScope(t.matches, scope);
    const engine = scope === SCOPE_COC || isStandardDoubleElim(ms) ? new BracketEngine(ms) : null;
    for (const m of ms) {
      if (m.winnerId) { if (isRealMatch(m)) played++; continue; }
      if (m.bracket === "grand_final" && m.round === 2) { if (isRealMatch(m)) remaining++; continue; }
      if (isRealMatch(m) || engine?.liveSlots(m) === 2) remaining++;
    }
  }
  return { played, total: played + remaining };
}

// ---- Athlete history across tournaments ------------------------------------

export interface AthleteResult {
  tournamentId: string;
  tournamentName: string;
  date: string;
  category: string | null;
  rank: number | null;
  fieldSize: number;
  wins: number;
  losses: number;
  overallChampion: boolean;
}

export interface AthleteSummary {
  key: string;
  name: string;
  clubs: string[];
  photoUrl: string | null;
  tournaments: number;
  entries: number;
  wins: number;
  losses: number;
  gold: number;
  silver: number;
  bronze: number;
  overallTitles: number;
  results: AthleteResult[];
}

export function athleteNameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Groups entries by athlete name (case-insensitive) across all given tournaments. */
export function computeAthleteHistory(tournaments: TournamentWithDetails[]): AthleteSummary[] {
  const athletes = new Map<string, AthleteSummary>();

  for (const t of tournaments) {
    const overall = getOverallChampionId(t.matches);
    const categories: (string | null)[] = t.weightCategories?.length ? t.weightCategories : [null];
    const seenInTournament = new Set<string>();

    for (const cat of categories) {
      const entrants = cat ? t.participants.filter(p => p.weightCategory === cat) : t.participants;
      const catMatches = categoryMatches(t.matches, cat);
      const rankings = computeCategoryRankings(t.matches, t.participants, cat);

      for (const p of entrants) {
        const k = athleteNameKey(p.name);
        if (!k) continue;
        let a = athletes.get(k);
        if (!a) {
          a = { key: k, name: p.name.trim(), clubs: [], photoUrl: null, tournaments: 0, entries: 0, wins: 0, losses: 0, gold: 0, silver: 0, bronze: 0, overallTitles: 0, results: [] };
          athletes.set(k, a);
        }
        if (p.club?.trim() && !a.clubs.some(c => c.toLowerCase() === p.club!.trim().toLowerCase())) a.clubs.push(p.club.trim());
        if (p.photoUrl && !a.photoUrl) a.photoUrl = p.photoUrl;
        if (!seenInTournament.has(k)) { seenInTournament.add(k); a.tournaments++; }

        // Count this entry's own category matches plus any Champion of Champions matches.
        const rec = playerRecord([...catMatches, ...t.matches.filter(m => m.bracket === COC)], p.id);
        const rank = rankings.find(r => r.participantId === p.id)?.rank ?? null;
        a.entries++;
        a.wins += rec.wins;
        a.losses += rec.losses;
        if (rank === 1) a.gold++;
        if (rank === 2) a.silver++;
        if (rank === 3) a.bronze++;
        if (overall === p.id) a.overallTitles++;
        a.results.push({
          tournamentId: t.id, tournamentName: t.name,
          date: new Date(t.createdAt).toISOString(),
          category: cat, rank, fieldSize: entrants.length,
          wins: rec.wins, losses: rec.losses, overallChampion: overall === p.id,
        });
      }
    }
  }

  const list = Array.from(athletes.values());
  for (const a of list) a.results.sort((x, y) => y.date.localeCompare(x.date));
  return list.sort((a, b) =>
    b.gold - a.gold || b.silver - a.silver || b.bronze - a.bronze || b.wins - a.wins || a.name.localeCompare(b.name));
}
