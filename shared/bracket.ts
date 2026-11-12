// Bracket engine (pure functions, shared by server and client).
//
// Double elimination uses the standard fixed structure for a bracket of size S
// (a power of two, W = log2 S winners rounds):
//
//   Losers R1            : losers of Winners R1, paired            (S/4 matches)
//   Losers R2            : Losers R1 winners v Winners R2 losers   (S/4)
//   Losers R3            : Losers R2 winners, paired               (S/8)
//   Losers R4            : Losers R3 winners v Winners R3 losers   (S/8)
//   ...
//   Losers R(2W-2)       : previous winner v Winners Final loser   (1)
//   Grand Final game 1   : winners champion v losers champion
//   Grand Final game 2   : only if the losers champion wins game 1
//
// Every slot therefore has exactly one place its player can come from, so a
// player can never be lost, and a slot that can no longer receive anybody
// ("dead") turns its match into a bye automatically.

import type { Match, SeedingMode } from "./schema";

export interface MatchDef {
  tournamentId: string;
  bracket: string;
  round: number;
  matchIndex: number;
  participant1Id: string | null;
  participant2Id: string | null;
  weightCategory: string | null;
}

export const COC = "champion_of_champions";

export function nextPowerOf2(n: number): number {
  let p = 2;
  while (p < n) p *= 2;
  return p;
}

export function bracketSizeFor(playerCount: number): number {
  return Math.max(4, nextPowerOf2(playerCount));
}

/** Seed number (1-based) for each first-round slot, e.g. size 8 -> [1,8,4,5,2,7,3,6]. */
export function seedOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const next: number[] = [];
    const total = order.length * 2 + 1;
    for (const s of order) next.push(s, total - s);
    order = next;
  }
  return order;
}

/**
 * First-round line-up for a list of player ids (already in seed order).
 *  - sequential: 1v2, 3v4 ... in list order; with an odd count the last player
 *    (or `byeRecipientId`) sits alone and gets the bye.
 *  - random: same layout after shuffling.
 *  - ranked: classic seeding (1 v lowest, top seeds apart, byes to top seeds).
 */
export function buildSlots(
  ids: string[],
  size: number,
  mode: SeedingMode,
  opts: { byeRecipientId?: string | null; random?: () => number } = {},
): (string | null)[] {
  const slots: (string | null)[] = Array(size).fill(null);
  if (mode === "ranked") {
    const order = seedOrder(size);
    for (let i = 0; i < size; i++) slots[i] = ids[order[i] - 1] ?? null;
    return slots;
  }

  let list = [...ids];
  if (mode === "random") {
    const rand = opts.random ?? Math.random;
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
  }
  const bye = opts.byeRecipientId;
  if (bye && list.length % 2 !== 0 && list.includes(bye)) {
    list = list.filter(id => id !== bye);
    list.push(bye);
  }
  for (let i = 0; i < list.length; i++) slots[i] = list[i];
  return slots;
}

export function losersRoundCount(size: number): number {
  return 2 * (Math.log2(size) - 1);
}

export function losersMatchCount(size: number, round: number): number {
  return size / Math.pow(2, Math.ceil(round / 2) + 1);
}

export function generateDoubleElimination(
  tournamentId: string, slots: (string | null)[], size: number, weightCategory: string | null = null,
): MatchDef[] {
  const W = Math.log2(size);
  const defs: MatchDef[] = [];
  const blank = { tournamentId, participant1Id: null, participant2Id: null, weightCategory };

  for (let i = 0; i < size / 2; i++) {
    defs.push({
      ...blank, bracket: "winners", round: 1, matchIndex: i,
      participant1Id: slots[i * 2] ?? null, participant2Id: slots[i * 2 + 1] ?? null,
    });
  }
  for (let r = 2; r <= W; r++) {
    for (let i = 0; i < size / Math.pow(2, r); i++) {
      defs.push({ ...blank, bracket: "winners", round: r, matchIndex: i });
    }
  }
  for (let r = 1; r <= losersRoundCount(size); r++) {
    for (let i = 0; i < losersMatchCount(size, r); i++) {
      defs.push({ ...blank, bracket: "losers", round: r, matchIndex: i });
    }
  }
  defs.push({ ...blank, bracket: "grand_final", round: 1, matchIndex: 0 });
  defs.push({ ...blank, bracket: "grand_final", round: 2, matchIndex: 0 });
  return defs;
}

export function generateSingleElimination(tournamentId: string, slots: (string | null)[], size: number, bracket = COC): MatchDef[] {
  const rounds = Math.log2(size);
  const defs: MatchDef[] = [];
  for (let r = 1; r <= rounds; r++) {
    for (let i = 0; i < size / Math.pow(2, r); i++) {
      defs.push({
        tournamentId, bracket, round: r, matchIndex: i, weightCategory: null,
        participant1Id: r === 1 ? slots[i * 2] ?? null : null,
        participant2Id: r === 1 ? slots[i * 2 + 1] ?? null : null,
      });
    }
  }
  return defs;
}

type Slot = 1 | 2;
interface Ref { bracket: string; round: number; matchIndex: number; slot: Slot }
interface Feed { kind: "winner" | "loser"; bracket: string; round: number; matchIndex: number }

// Winners-round losers drop in reversed order on even rounds, which keeps
// players who already met apart for as long as possible.
function dropIndex(winnersRound: number, index: number, count: number): number {
  return winnersRound % 2 === 0 ? count - 1 - index : index;
}

const key = (bracket: string, round: number, matchIndex: number) => `${bracket}:${round}:${matchIndex}`;

/** True when a set of matches (one category) has the standard structure this engine runs on. */
export function isStandardDoubleElim(matches: Match[]): boolean {
  const count = (bracket: string, round: number) => matches.filter(m => m.bracket === bracket && m.round === round).length;
  const size = count("winners", 1) * 2;
  const W = Math.log2(size);
  if (size < 4 || !Number.isInteger(W)) return false;
  for (let r = 1; r <= W; r++) if (count("winners", r) !== size / Math.pow(2, r)) return false;
  const L = losersRoundCount(size);
  const maxLosersRound = Math.max(0, ...matches.filter(m => m.bracket === "losers").map(m => m.round));
  if (maxLosersRound !== L) return false;
  for (let r = 1; r <= L; r++) if (count("losers", r) !== losersMatchCount(size, r)) return false;
  return count("grand_final", 1) === 1 && count("grand_final", 2) === 1;
}

/**
 * Works on the matches of ONE bracket set: either a category's
 * winners/losers/grand-final matches, or the Champion of Champions matches.
 * Mutates the Match objects it is given; callers persist the differences.
 */
export class BracketEngine {
  readonly size: number;
  readonly isCoc: boolean;
  private byKey = new Map<string, Match>();
  private memo = new Map<string, "filled" | "pending" | "dead">();

  constructor(readonly matches: Match[]) {
    this.isCoc = matches.some(m => m.bracket === COC);
    const firstBracket = this.isCoc ? COC : "winners";
    this.size = matches.filter(m => m.bracket === firstBracket && m.round === 1).length * 2;
    for (const m of matches) this.byKey.set(key(m.bracket, m.round, m.matchIndex), m);
  }

  private get W() { return Math.log2(this.size); }
  private get L() { return losersRoundCount(this.size); }

  find(bracket: string, round: number, matchIndex: number): Match | undefined {
    return this.byKey.get(key(bracket, round, matchIndex));
  }

  private winnerTarget(m: Match): Ref | null {
    const pairSlot = ((m.matchIndex % 2) + 1) as Slot;
    const half = Math.floor(m.matchIndex / 2);
    if (m.bracket === COC) {
      return m.round < this.W ? { bracket: COC, round: m.round + 1, matchIndex: half, slot: pairSlot } : null;
    }
    if (m.bracket === "winners") {
      return m.round < this.W
        ? { bracket: "winners", round: m.round + 1, matchIndex: half, slot: pairSlot }
        : { bracket: "grand_final", round: 1, matchIndex: 0, slot: 1 };
    }
    if (m.bracket === "losers") {
      if (m.round >= this.L) return { bracket: "grand_final", round: 1, matchIndex: 0, slot: 2 };
      return m.round % 2 === 1
        ? { bracket: "losers", round: m.round + 1, matchIndex: m.matchIndex, slot: 1 }
        : { bracket: "losers", round: m.round + 1, matchIndex: half, slot: pairSlot };
    }
    return null;
  }

  private loserTarget(m: Match): Ref | null {
    if (m.bracket !== "winners") return null;
    if (m.round === 1) {
      return { bracket: "losers", round: 1, matchIndex: Math.floor(m.matchIndex / 2), slot: ((m.matchIndex % 2) + 1) as Slot };
    }
    const count = this.size / Math.pow(2, m.round);
    return { bracket: "losers", round: 2 * (m.round - 1), matchIndex: dropIndex(m.round, m.matchIndex, count), slot: 2 };
  }

  private feeder(m: Match, slot: Slot): Feed | null {
    const pair = m.matchIndex * 2 + (slot - 1);
    if (m.bracket === COC || m.bracket === "winners") {
      return m.round === 1 ? null : { kind: "winner", bracket: m.bracket, round: m.round - 1, matchIndex: pair };
    }
    if (m.bracket === "losers") {
      if (m.round === 1) return { kind: "loser", bracket: "winners", round: 1, matchIndex: pair };
      if (m.round % 2 === 1) return { kind: "winner", bracket: "losers", round: m.round - 1, matchIndex: pair };
      if (slot === 1) return { kind: "winner", bracket: "losers", round: m.round - 1, matchIndex: m.matchIndex };
      const winnersRound = m.round / 2 + 1;
      const count = this.size / Math.pow(2, winnersRound);
      return { kind: "loser", bracket: "winners", round: winnersRound, matchIndex: dropIndex(winnersRound, m.matchIndex, count) };
    }
    if (m.bracket === "grand_final" && m.round === 1) {
      return slot === 1
        ? { kind: "winner", bracket: "winners", round: this.W, matchIndex: 0 }
        : { kind: "winner", bracket: "losers", round: this.L, matchIndex: 0 };
    }
    return null;
  }

  /** filled = player is there; pending = a player will still arrive; dead = nobody ever will. */
  slotState(m: Match, slot: Slot): "filled" | "pending" | "dead" {
    if (slot === 1 ? m.participant1Id : m.participant2Id) return "filled";
    const memoKey = `${m.id}:${slot}`;
    const cached = this.memo.get(memoKey);
    if (cached) return cached;

    let state: "pending" | "dead" = "dead";
    const feed = this.feeder(m, slot);
    const src = feed && this.find(feed.bracket, feed.round, feed.matchIndex);
    if (feed && src && !src.winnerId) {
      const live = this.liveSlots(src);
      // A winner arrives if the source match has anyone; a loser only if it is a real match.
      if (feed.kind === "winner" ? live >= 1 : live === 2) state = "pending";
    }
    this.memo.set(memoKey, state);
    return state;
  }

  liveSlots(m: Match): number {
    return (this.slotState(m, 1) !== "dead" ? 1 : 0) + (this.slotState(m, 2) !== "dead" ? 1 : 0);
  }

  /** A match that will never have a player in it (shown nowhere). */
  isDead(m: Match): boolean {
    if (m.winnerId) return false;
    if (m.bracket === "grand_final" && m.round === 2) return false;
    return this.liveSlots(m) === 0;
  }

  private place(ref: Ref, participantId: string) {
    const target = this.find(ref.bracket, ref.round, ref.matchIndex);
    if (!target) throw new Error(`Bracket is missing ${ref.bracket} round ${ref.round} match ${ref.matchIndex}`);
    const current = ref.slot === 1 ? target.participant1Id : target.participant2Id;
    if (current && current !== participantId) {
      throw new Error(`Slot already taken in ${ref.bracket} round ${ref.round} match ${ref.matchIndex}`);
    }
    if (ref.slot === 1) target.participant1Id = participantId; else target.participant2Id = participantId;
  }

  private advance(m: Match, winnerId: string, loserId: string | null) {
    if (m.bracket === "grand_final") {
      // Losers champion won game 1: both now have one loss, play the reset game.
      if (m.round === 1 && winnerId !== m.participant1Id) {
        const reset = this.find("grand_final", 2, 0);
        if (reset) {
          reset.participant1Id = m.participant1Id;
          reset.participant2Id = m.participant2Id;
        }
      }
      return;
    }
    const wt = this.winnerTarget(m);
    if (wt) this.place(wt, winnerId);
    const lt = loserId ? this.loserTarget(m) : null;
    if (lt && loserId) this.place(lt, loserId);
  }

  /** Auto-advance every player whose opponent slot can never be filled. Returns ids of matches closed as byes. */
  settleByes(now: Date = new Date()): string[] {
    const closed: string[] = [];
    let changed = true;
    while (changed) {
      changed = false;
      this.memo.clear();
      for (const m of this.matches) {
        if (m.winnerId || m.bracket === "grand_final") continue;
        const has1 = !!m.participant1Id;
        const has2 = !!m.participant2Id;
        if (has1 === has2) continue;
        if (this.slotState(m, has1 ? 2 : 1) !== "dead") continue;
        const winner = (has1 ? m.participant1Id : m.participant2Id)!;
        m.winnerId = winner;
        m.winMethod = "bye";
        m.completedAt = now;
        m.tableNumber = null;
        this.advance(m, winner, null);
        closed.push(m.id);
        changed = true;
        break;
      }
    }
    this.memo.clear();
    return closed;
  }

  /** Record a result, move both players on, then resolve any byes that creates. */
  decide(matchId: string, winnerId: string, method: "pin" | "fouls", now: Date = new Date()) {
    const m = this.matches.find(x => x.id === matchId);
    if (!m) throw new Error("Match not found in bracket");
    if (m.winnerId) throw new Error("Match already decided");
    if (!m.participant1Id || !m.participant2Id) throw new Error("Both participants must be set");
    if (winnerId !== m.participant1Id && winnerId !== m.participant2Id) throw new Error("Winner must be in the match");
    const loserId = winnerId === m.participant1Id ? m.participant2Id : m.participant1Id;
    m.winnerId = winnerId;
    m.winMethod = method;
    m.completedAt = now;
    m.tableNumber = null;
    this.advance(m, winnerId, loserId);
    this.settleByes(now);
  }

  /** Winner of the whole bracket set, or null while it is still running. */
  champion(): string | null {
    if (this.isCoc) {
      const final = this.find(COC, this.W, 0);
      return final?.winnerId ?? null;
    }
    const gf1 = this.find("grand_final", 1, 0);
    const gf2 = this.find("grand_final", 2, 0);
    if (!gf1?.winnerId) return null;
    if (gf1.winnerId === gf1.participant1Id) return gf1.winnerId;
    return gf2?.winnerId ?? null;
  }
}
