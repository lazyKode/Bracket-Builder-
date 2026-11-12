// Geometry for drawing a bracket as columns of match cards joined by lines.
// Shared by the on-screen bracket and the printable bracket sheets.
import type { Match } from "@shared/schema";
import { isByeMatch, roundLabel } from "@shared/stats";

export const CARD_W = 196;
export const CARD_H = 66;
export const BYE_H = 28;
export const SLOT_H = 90;
export const COL_GAP = 44;
export const HEADER_H = 30;

export interface RoundColumn {
  round: number;
  title: string;
  /** Matches the structure has in this round (including ones that are not drawn). */
  fullCount: number;
  matches: Match[];
}

export interface BracketLayout {
  cols: RoundColumn[];
  cards: { match: Match; compact: boolean; left: number; top: number }[];
  lines: string[];
  width: number;
  height: number;
}

export function buildColumns(all: Match[], visible: Match[], bracket: string): RoundColumn[] {
  const inBracket = all.filter(m => m.bracket === bracket);
  const rounds = Array.from(new Set(inBracket.map(m => m.round))).sort((a, b) => a - b);
  return rounds.map(round => {
    const full = inBracket.filter(m => m.round === round);
    return {
      round,
      title: roundLabel(full[0], all),
      fullCount: full.length,
      matches: visible.filter(m => m.bracket === bracket && m.round === round).sort((a, b) => a.matchIndex - b.matchIndex),
    };
  });
}

/**
 * Every match sits at the height its position in the structure dictates, so
 * the lines between rounds always join the right cards even when matches that
 * will never be played are left out.
 */
export function computeLayout(columns: RoundColumn[]): BracketLayout | null {
  const cols = columns.filter(c => c.matches.length > 0);
  if (!cols.length) return null;
  const baseCount = Math.max(...cols.map(c => c.fullCount));
  const centerOf = (col: RoundColumn, index: number) => (index + 0.5) * (baseCount / col.fullCount) * SLOT_H;

  let minTop = Infinity;
  let maxBottom = 0;
  for (const col of cols) {
    for (const m of col.matches) {
      const y = centerOf(col, m.matchIndex);
      minTop = Math.min(minTop, y - CARD_H / 2);
      maxBottom = Math.max(maxBottom, y + CARD_H / 2);
    }
  }
  const offset = minTop - 14;
  const xOf = (ci: number) => ci * (CARD_W + COL_GAP);

  const cards = cols.flatMap((col, ci) => col.matches.map(m => {
    const compact = isByeMatch(m);
    return {
      match: m, compact,
      left: xOf(ci),
      top: HEADER_H + centerOf(col, m.matchIndex) - offset - (compact ? BYE_H : CARD_H) / 2,
    };
  }));

  const lines: string[] = [];
  for (let ci = 0; ci < cols.length - 1; ci++) {
    const from = cols[ci];
    const to = cols[ci + 1];
    if (to.round !== from.round + 1) continue;
    const sameSize = from.fullCount === to.fullCount;
    const halves = from.fullCount === to.fullCount * 2;
    if (!sameSize && !halves) continue;
    for (const m of from.matches) {
      const targetIndex = sameSize ? m.matchIndex : Math.floor(m.matchIndex / 2);
      if (!to.matches.some(t => t.matchIndex === targetIndex)) continue;
      const x1 = xOf(ci) + CARD_W;
      const x2 = xOf(ci + 1);
      const y1 = HEADER_H + centerOf(from, m.matchIndex) - offset;
      const y2 = HEADER_H + centerOf(to, targetIndex) - offset;
      lines.push(`M ${x1} ${y1} H ${x1 + COL_GAP / 2} V ${y2} H ${x2}`);
    }
  }

  return {
    cols, cards, lines,
    width: cols.length * CARD_W + (cols.length - 1) * COL_GAP,
    height: HEADER_H + (maxBottom - offset) + 6,
  };
}
