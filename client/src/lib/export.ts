// Exports: CSV downloads, a results PDF, and printable result / bracket sheets.
import type { Match, Participant, TournamentWithDetails } from "@shared/schema";
import { BracketEngine, COC, isStandardDoubleElim } from "@shared/bracket";
import {
  categoryMatches, computeCategoryRankings, computeTeamStandings, getOverallChampionId,
  isRealMatch, matchesInScope, ordinal, roundLabel, scopeOfMatch, visibleMatches, TEAM_POINTS,
} from "@shared/stats";
import { BYE_H, CARD_H, CARD_W, COL_GAP, buildColumns, computeLayout } from "./bracket-layout";
import { saveBlob, usesShareSheet } from "./save-file";

type Details = Pick<TournamentWithDetails, "name" | "status" | "participants" | "matches" | "weightCategories" | "tableCount" | "createdAt">;

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function fileSlug(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "tournament";
}

function categoriesOf(t: Details): (string | null)[] {
  return t.weightCategories?.length ? t.weightCategories : [null];
}

function overallChampion(t: Details): Participant | null {
  const id = getOverallChampionId(t.matches);
  return id ? t.participants.find(p => p.id === id) ?? null : null;
}

// ---- CSV -------------------------------------------------------------------

function csvCell(value: string | number | null | undefined): string {
  const s = value == null ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]) {
  // BOM so Excel opens names with accents or Devanagari correctly.
  const blob = new Blob(["\uFEFF" + rows.map(r => r.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
  void saveBlob(blob, filename);
}

export function exportResultsCsv(t: Details) {
  const rows: (string | number | null)[][] = [["Class", "Place", "Athlete", "Club", "Wins", "Losses", "Fouls"]];
  for (const cat of categoriesOf(t)) {
    for (const r of computeCategoryRankings(t.matches, t.participants, cat)) {
      rows.push([cat ?? t.name, r.rank, r.name, r.club, r.wins, r.losses, r.fouls]);
    }
  }
  downloadCsv(`${fileSlug(t.name)}-results.csv`, rows);
}

export function exportMatchesCsv(t: Details) {
  const name = (id: string | null) => t.participants.find(p => p.id === id)?.name ?? "";
  const rows: (string | number | null)[][] = [[
    "Match #", "Class", "Round", "Athlete 1", "Athlete 2", "Winner", "Decided by", "Fouls 1", "Fouls 2", "Finished",
  ]];
  const played = t.matches
    .filter(m => m.winnerId && isRealMatch(m))
    .sort((a, b) => (a.matchNumber ?? 1e9) - (b.matchNumber ?? 1e9));
  for (const m of played) {
    rows.push([
      m.matchNumber,
      m.bracket === COC ? "Champion of Champions" : m.weightCategory ?? t.name,
      roundLabel(m, matchesInScope(t.matches, scopeOfMatch(m))),
      name(m.participant1Id), name(m.participant2Id), name(m.winnerId),
      m.winMethod === "fouls" ? "Fouls (DQ)" : "Pin",
      m.participant1Fouls, m.participant2Fouls,
      m.completedAt ? new Date(m.completedAt).toLocaleString() : "",
    ]);
  }
  downloadCsv(`${fileSlug(t.name)}-matches.csv`, rows);
}

// ---- PDF -------------------------------------------------------------------

export async function exportResultsPdf(t: Details) {
  // Loaded on demand so the PDF library is not part of the normal page load.
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 40;
  const purple: [number, number, number] = [124, 58, 237];

  doc.setFont("helvetica", "bold").setFontSize(20).setTextColor(...purple);
  doc.text(t.name, pageW / 2, 56, { align: "center" });
  doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(107, 114, 128);
  const done = t.status === "completed";
  doc.text(`${done ? "Final results" : "Results so far"} · ${new Date(t.createdAt).toLocaleDateString()}`, pageW / 2, 74, { align: "center" });

  let y = 96;
  const champ = overallChampion(t);
  if (champ) {
    doc.setDrawColor(245, 158, 11).setFillColor(255, 251, 235).roundedRect(margin, y, pageW - margin * 2, 46, 6, 6, "FD");
    doc.setFont("helvetica", "bold").setFontSize(9).setTextColor(180, 83, 9);
    doc.text("OVERALL CHAMPION", pageW / 2, y + 17, { align: "center" });
    doc.setFontSize(16).setTextColor(146, 64, 14);
    doc.text(champ.club ? `${champ.name} (${champ.club})` : champ.name, pageW / 2, y + 36, { align: "center" });
    y += 62;
  }

  const lastY = () => (doc as any).lastAutoTable?.finalY ?? y;
  for (const cat of categoriesOf(t)) {
    const rankings = computeCategoryRankings(t.matches, t.participants, cat);
    if (!rankings.length) continue;
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [[{ content: cat ?? "Rankings", colSpan: 4, styles: { halign: "left", fillColor: purple } }], ["Place", "Athlete", "Club", "W-L"]],
      body: rankings.map(r => [ordinal(r.rank), r.name, r.club ?? "", `${r.wins}-${r.losses}`]),
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: [237, 233, 254], textColor: [55, 48, 107], fontStyle: "bold" },
      columnStyles: { 0: { cellWidth: 50 }, 3: { cellWidth: 46, halign: "center" } },
      didParseCell: (data) => {
        if (data.section === "head" && data.row.index === 0) data.cell.styles.textColor = [255, 255, 255];
        if (data.section === "body" && data.row.index < 3) data.cell.styles.fontStyle = "bold";
      },
    });
    y = lastY() + 16;
  }

  const teams = computeTeamStandings(t).filter(team => team.points > 0);
  if (teams.length) {
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [[{ content: "Team standings", colSpan: 6, styles: { halign: "left", fillColor: [245, 158, 11] } }], ["#", "Club", "Points", "Gold", "Silver", "Bronze"]],
      body: teams.map((team, i) => [i + 1, team.club, team.points, team.gold, team.silver, team.bronze]),
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: [254, 243, 199], textColor: [120, 53, 15], fontStyle: "bold" },
      didParseCell: (data) => {
        if (data.section === "head" && data.row.index === 0) data.cell.styles.textColor = [255, 255, 255];
      },
    });
    y = lastY() + 8;
    doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(107, 114, 128);
    doc.text(`Points per class for places 1-${TEAM_POINTS.length}: ${TEAM_POINTS.join(", ")}`, margin, y + 6);
  }

  await saveBlob(doc.output("blob"), `${fileSlug(t.name)}-results.pdf`);
}

// ---- Printable pages --------------------------------------------------------

function openPrintWindow(title: string, body: string, extraCss = "", filename = "page.html") {
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #111827; margin: 0; padding: 20px; }
  h1 { text-align: center; color: #7c3aed; margin: 0 0 4px; }
  .subtitle { text-align: center; color: #6b7280; margin: 0 0 20px; font-size: 14px; }
  .print-btn { display: block; margin: 0 auto 20px; padding: 10px 24px; background: #7c3aed; color: white; border: none; border-radius: 6px; font-size: 14px; cursor: pointer; }
  @media print { .no-print { display: none !important; } body { padding: 0; } }
  ${extraCss}
</style></head>
<body>
  <button class="print-btn no-print" onclick="window.print()">Print or save as PDF</button>
  ${body}
</body></html>`;
  if (usesShareSheet()) {
    // The app has no pop-up windows: share the page as a file instead (open it to print or AirPrint).
    void saveBlob(new Blob([html], { type: "text/html" }), filename);
    return true;
  }
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.write(html);
  w.document.close();
  return true;
}

export function printResults(t: Details): boolean {
  const champ = overallChampion(t);
  const cats = categoriesOf(t);
  let sections = "";
  for (const cat of cats) {
    const rankings = computeCategoryRankings(t.matches, t.participants, cat);
    if (!rankings.length) continue;
    const rows = rankings.map(r => {
      const medal = r.rank === 1 ? "&#x1F947;" : r.rank === 2 ? "&#x1F948;" : r.rank === 3 ? "&#x1F949;" : `${r.rank}.`;
      return `<tr><td class="place">${medal}</td><td style="font-weight:${r.rank <= 3 ? "bold" : "normal"}">${escapeHtml(r.name)}${r.club ? `<span class="club"> · ${escapeHtml(r.club)}</span>` : ""}</td><td class="rec">${r.wins}-${r.losses}</td></tr>`;
    }).join("");
    sections += `<div class="cat"><h3>${escapeHtml(cat || "Tournament")}</h3><table><tbody>${rows}</tbody></table></div>`;
  }

  const teams = computeTeamStandings(t).filter(team => team.points > 0);
  const teamSection = teams.length ? `
    <div class="cat teams"><h3>Team standings</h3>
      <table><thead><tr><th></th><th style="text-align:left">Club</th><th>Pts</th><th>G</th><th>S</th><th>B</th></tr></thead><tbody>
      ${teams.map((team, i) => `<tr><td class="place">${i + 1}.</td><td>${escapeHtml(team.club)}</td><td class="rec"><b>${team.points}</b></td><td class="rec">${team.gold}</td><td class="rec">${team.silver}</td><td class="rec">${team.bronze}</td></tr>`).join("")}
      </tbody></table>
    </div>` : "";

  const body = `
    <h1>${escapeHtml(t.name)}</h1>
    <p class="subtitle">Tournament Results</p>
    ${champ ? `<div class="champion"><h2>Overall Champion</h2><p class="name">&#x1F3C6; ${escapeHtml(champ.name)}</p></div>` : ""}
    <div class="${cats.length > 1 ? "grid" : ""}">${sections}</div>
    ${teamSection}`;
  return openPrintWindow(`${t.name} - Results`, body, `
    body { max-width: 820px; margin: 0 auto; }
    .champion { text-align: center; padding: 16px; margin-bottom: 24px; border: 2px solid #f59e0b; border-radius: 8px; background: #fffbeb; }
    .champion h2 { color: #b45309; margin: 0 0 4px; font-size: 14px; text-transform: uppercase; letter-spacing: 2px; }
    .champion .name { font-size: 28px; font-weight: bold; color: #92400e; margin: 0; }
    .grid { columns: 2; column-gap: 24px; }
    @media (max-width: 600px) { .grid { columns: 1; } }
    .cat { margin-bottom: 24px; break-inside: avoid; }
    .cat h3 { font-size: 16px; margin: 0 0 8px; color: #374151; border-bottom: 2px solid #7c3aed; padding-bottom: 4px; }
    .teams h3 { border-bottom-color: #f59e0b; }
    table { width: 100%; border-collapse: collapse; }
    td, th { padding: 6px 10px; border-bottom: 1px solid #e5e7eb; font-size: 14px; }
    th { font-size: 11px; color: #6b7280; text-transform: uppercase; }
    .place { width: 34px; font-size: 16px; }
    .rec { width: 44px; text-align: center; color: #4b5563; font-variant-numeric: tabular-nums; }
    .club { color: #6b7280; font-weight: normal; font-size: 12px; }
  `, `${fileSlug(t.name)}-results.html`);
}

function bracketSectionHtml(all: Match[], visible: Match[], bracket: string, participants: Participant[], engine: BracketEngine | null): string {
  const layout = computeLayout(buildColumns(all, visible, bracket));
  if (!layout) return "";
  const name = (id: string | null) => participants.find(p => p.id === id)?.name ?? "";

  const headers = layout.cols.map((col, ci) =>
    `<div class="colhead" style="left:${ci * (CARD_W + COL_GAP)}px;width:${CARD_W}px">${escapeHtml(col.title)}</div>`).join("");

  const cards = layout.cards.map(({ match: m, compact, left, top }) => {
    if (compact) {
      return `<div class="bye" style="left:${left}px;top:${top}px;width:${CARD_W}px;height:${BYE_H}px">${escapeHtml(name(m.winnerId))} — bye</div>`;
    }
    const row = (pid: string | null, slot: 1 | 2) => {
      const won = !!pid && m.winnerId === pid;
      const lost = !!pid && !!m.winnerId && m.winnerId !== pid;
      const fouls = slot === 1 ? m.participant1Fouls : m.participant2Fouls;
      const empty = engine && engine.slotState(m, slot) === "dead" ? "bye" : "";
      const tag = lost && fouls >= 2 ? " (DQ)" : won ? " ✓" : "";
      return `<div class="slot${won ? " won" : ""}${lost ? " lost" : ""}">${pid ? escapeHtml(name(pid)) + tag : `<i>${empty}</i>`}</div>`;
    };
    const num = m.matchNumber != null ? `<span class="num">#${m.matchNumber}</span>` : "";
    return `<div class="card" style="left:${left}px;top:${top}px;width:${CARD_W}px;height:${CARD_H}px">${num}${row(m.participant1Id, 1)}${row(m.participant2Id, 2)}</div>`;
  }).join("");

  const lines = layout.lines.map(d => `<path d="${d}" fill="none" stroke="#9ca3af" stroke-width="1.2"/>`).join("");
  // Scale wide brackets down so they fit a landscape page.
  const zoom = Math.min(1, 1040 / layout.width);
  return `<div class="bracket" style="width:${layout.width}px;height:${layout.height}px;zoom:${zoom.toFixed(3)}">
    <svg width="${layout.width}" height="${layout.height}" style="position:absolute;left:0;top:0">${lines}</svg>${headers}${cards}</div>`;
}

/** One landscape sheet per class: winners bracket, losers bracket and grand final, filled in or blank. */
export function printBrackets(t: Details): boolean {
  let pages = "";
  for (const cat of categoriesOf(t)) {
    const all = categoryMatches(t.matches, cat);
    if (!all.length) continue;
    const visible = visibleMatches(all);
    const engine = isStandardDoubleElim(all) ? new BracketEngine(all) : null;
    const name = (id: string | null) => t.participants.find(p => p.id === id)?.name ?? "";
    const gf = all.filter(m => m.bracket === "grand_final").sort((a, b) => a.round - b.round);
    const gfRow = (m: Match, pid: string | null, placeholder: string) => {
      const won = !!pid && m.winnerId === pid;
      const lost = !!pid && !!m.winnerId && m.winnerId !== pid;
      return `<div class="slot${won ? " won" : ""}${lost ? " lost" : ""}">${pid ? escapeHtml(name(pid)) + (won ? " ✓" : "") : `<i>${placeholder}</i>`}</div>`;
    };
    const gfHtml = gf.filter(m => m.round === 1 || isRealMatch(m)).map(m => `
      <div class="gf"><div class="gflabel">${m.round === 1 ? "Grand Final" : "Grand Final — reset"}${m.matchNumber != null ? ` · #${m.matchNumber}` : ""}</div>
        ${gfRow(m, m.participant1Id, "Winners champion")}${gfRow(m, m.participant2Id, "Losers champion")}
      </div>`).join("");
    const losers = bracketSectionHtml(all, visible, "losers", t.participants, engine);
    pages += `<section class="page">
      <h2>${escapeHtml(cat ?? t.name)}</h2>
      <h3>Winners bracket</h3>${bracketSectionHtml(all, visible, "winners", t.participants, engine)}
      ${losers ? `<h3>Losers bracket</h3>${losers}` : ""}
      <h3>Grand final</h3><div class="gfs">${gfHtml}</div>
    </section>`;
  }

  const coc = t.matches.filter(m => m.bracket === COC);
  if (coc.length) {
    pages += `<section class="page"><h2>Champion of Champions</h2>${bracketSectionHtml(coc, visibleMatches(coc), COC, t.participants, new BracketEngine(coc))}</section>`;
  }
  if (!pages) return false;

  const body = `<h1 class="no-print">${escapeHtml(t.name)}</h1><p class="subtitle no-print">Bracket sheets — one page per class, landscape</p>${pages}`;
  return openPrintWindow(`${t.name} - Brackets`, body, `
    @page { size: landscape; margin: 10mm; }
    .page { break-after: page; margin-bottom: 32px; }
    .page:last-child { break-after: auto; }
    h2 { font-size: 18px; margin: 0 0 6px; color: #111827; border-bottom: 2px solid #7c3aed; padding-bottom: 4px; }
    h3 { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #6b7280; margin: 12px 0 2px; }
    .bracket { position: relative; }
    .colhead { position: absolute; top: 0; height: 20px; text-align: center; font-size: 10px; font-weight: 600; text-transform: uppercase; color: #6b7280; }
    .card, .gf { position: absolute; box-sizing: border-box; border: 1px solid #6b7280; border-radius: 6px; background: #fff; font-size: 12px; }
    .gf { position: relative; width: ${CARD_W + 24}px; }
    .gfs { display: flex; gap: 28px; margin-top: 18px; }
    .gflabel { position: absolute; top: -15px; left: 0; font-size: 10px; color: #6b7280; }
    .slot { height: 32px; line-height: 32px; padding: 0 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .slot + .slot { border-top: 1px solid #d1d5db; }
    .slot.won { font-weight: 700; }
    .slot.lost { color: #9ca3af; text-decoration: line-through; }
    .slot i { color: #9ca3af; font-size: 11px; }
    .num { position: absolute; top: -8px; left: 6px; background: #fff; padding: 0 3px; font-size: 9px; color: #6b7280; font-family: monospace; }
    .bye { position: absolute; box-sizing: border-box; border: 1px dashed #9ca3af; border-radius: 4px; font-size: 10px; font-style: italic; color: #6b7280; line-height: ${BYE_H - 2}px; padding: 0 8px; white-space: nowrap; overflow: hidden; }
  `, `${fileSlug(t.name)}-brackets.html`);
}
