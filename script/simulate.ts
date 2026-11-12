// Bracket simulation suite.  Run with:  npm run simulate
//
// Plays thousands of complete tournaments through the same code the server
// and the offline app use (in-memory storage, no database needed) and checks that:
//   * every bracket finishes,
//   * nobody is ever dropped: everyone except the champion loses exactly twice,
//   * the number of matches is what double elimination requires (2n-2 or 2n-1),
//   * undo restores the bracket exactly,
//   * Champion of Champions finishes for any number of champions,
//   * call numbers are unique and no table or athlete is double-booked.
import { MemStorage } from "../shared/storage";
import { createOps } from "../shared/ops";
import { seedOrder } from "../shared/bracket";
import { isReadyMatch, isRealMatch, computeCategoryRankings, getCategoryChampion, athleteKey } from "../shared/stats";
import type { Match, SeedingMode } from "../shared/schema";

const storage = new MemStorage();
const ops = createOps({ storage, notify: () => {} });

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

let failures = 0;
let checks = 0;
function expect(cond: boolean, message: string) {
  checks++;
  if (!cond) {
    failures++;
    if (failures <= 25) console.error("  FAIL:", message);
  }
}

const WC = (name: string) => ({ name, ageCategory: "seniors" as const, hand: "right" as const, gender: "men" as const });

async function makeTournament(classes: string[], counts: number[], mode: SeedingMode, tables = 1) {
  const t = await storage.createTournament({ name: "sim", size: 128, weightCategories: [], weightClasses: classes.map(WC), email: "" });
  await storage.updateTournamentSettings(t.id, { seedingMode: mode, tableCount: tables });
  const cats = t.weightCategories!;
  for (let c = 0; c < cats.length; c++) {
    for (let i = 0; i < counts[c]; i++) {
      await storage.addParticipant({ tournamentId: t.id, name: `${classes[c]}-P${i + 1}`, seed: i + 1, weightCategory: cats[c] });
    }
  }
  return { id: t.id, cats };
}

type Order = "random" | "winners-first" | "losers-first" | "by-number";

function pick(playable: Match[], order: Order, rand: () => number): Match {
  let pool = playable;
  if (order === "winners-first") { const w = playable.filter(m => m.bracket === "winners"); if (w.length) pool = w; }
  if (order === "losers-first") { const l = playable.filter(m => m.bracket === "losers"); if (l.length) pool = l; }
  if (order === "by-number") return [...playable].sort((a, b) => (a.matchNumber ?? 0) - (b.matchNumber ?? 0))[0];
  return pool[Math.floor(rand() * pool.length)];
}

async function checkCallSheet(tid: string, label: string) {
  const matches = await storage.getMatches(tid);
  const participants = await storage.getParticipants(tid);
  const byId = new Map(participants.map(p => [p.id, p]));
  const numbers = matches.map(m => m.matchNumber).filter((n): n is number => n != null);
  expect(new Set(numbers).size === numbers.length, `${label}: duplicate call numbers`);
  const ready = matches.filter(isReadyMatch);
  expect(ready.every(m => m.matchNumber != null), `${label}: ready match without a call number`);
  const onTable = ready.filter(m => m.tableNumber != null);
  expect(new Set(onTable.map(m => m.tableNumber)).size === onTable.length, `${label}: two matches on one table`);
  expect(matches.every(m => !(m.winnerId && m.tableNumber != null)), `${label}: finished match still on a table`);
  const athletes = onTable.flatMap(m => [athleteKey(byId.get(m.participant1Id!)), athleteKey(byId.get(m.participant2Id!))]);
  expect(new Set(athletes).size === athletes.length, `${label}: athlete called to two tables at once`);
}

async function playCategory(tid: string, cat: string, n: number, order: Order, rand: () => number, label: string, foulRate = 0) {
  for (let guard = 0; guard < 4 * n + 20; guard++) {
    const playable = (await storage.getMatches(tid)).filter(m => m.weightCategory === cat && isReadyMatch(m));
    if (!playable.length) break;
    const m = pick(playable, order, rand);
    const winnerId = rand() < 0.5 ? m.participant1Id! : m.participant2Id!;
    const loserId = winnerId === m.participant1Id ? m.participant2Id! : m.participant1Id!;
    if (rand() < foulRate) {
      // Disqualify the loser on fouls instead of a normal win.
      await ops.recordFoul(m.id, loserId);
      await ops.recordFoul(m.id, loserId);
    } else {
      await ops.recordWinner(m.id, winnerId);
    }
  }
  const matches = await storage.getMatches(tid);
  const participants = (await storage.getParticipants(tid)).filter(p => p.weightCategory === cat);
  // Count losses from the recorded results themselves.
  const losses = new Map<string, number>();
  let real = 0;
  for (const m of matches) {
    if (m.weightCategory !== cat || !m.winnerId || !isRealMatch(m)) continue;
    const loserId = m.winnerId === m.participant1Id ? m.participant2Id! : m.participant1Id!;
    losses.set(loserId, (losses.get(loserId) ?? 0) + 1);
    real++;
  }
  const champion = getCategoryChampion(matches, cat);
  expect(!!champion, `${label}: bracket did not finish`);
  const under = participants.filter(p => (losses.get(p.id) ?? 0) < 2);
  expect(under.length === 1 && under[0].id === champion, `${label}: ${under.length} players finished with fewer than 2 losses (expected only the champion)`);
  expect(participants.every(p => (losses.get(p.id) ?? 0) <= 2), `${label}: a player lost more than twice`);
  expect(real === 2 * n - 2 || real === 2 * n - 1, `${label}: ${real} matches played, expected ${2 * n - 2} or ${2 * n - 1}`);
  const rankings = computeCategoryRankings(matches, participants, cat);
  expect(rankings.length === n && rankings[0]?.participantId === champion, `${label}: rankings incomplete (${rankings.length}/${n})`);
  expect(rankings.every(r => r.wins + r.losses > 0 && r.losses === (losses.get(r.participantId) ?? 0)), `${label}: win-loss records do not match the results`);
  return champion;
}

async function testBrackets() {
  console.log("1. Full tournaments, 2-40 players x 3 seeding modes x 4 play orders");
  const orders: Order[] = ["random", "winners-first", "losers-first", "by-number"];
  const modes: SeedingMode[] = ["sequential", "ranked", "random"];
  let runs = 0;
  for (let n = 2; n <= 40; n++) {
    for (const mode of modes) {
      for (const order of orders) {
        for (let seed = 1; seed <= 3; seed++) {
          const rand = rng(n * 1000 + seed * 17 + orders.indexOf(order));
          const { id, cats } = await makeTournament(["A"], [n], mode, 3);
          const label = `n=${n} ${mode} ${order} #${seed}`;
          await ops.startCategory(id, cats[0], { random: rand });
          await checkCallSheet(id, label);
          await playCategory(id, cats[0], n, order, rand, label, 0.1);
          await checkCallSheet(id, label);
          expect((await storage.getTournament(id))!.status === "completed", `${label}: tournament status is not completed`);
          await storage.deleteTournament(id);
          runs++;
        }
      }
    }
  }
  for (const n of [64, 100, 128]) {
    const rand = rng(n);
    const { id, cats } = await makeTournament(["A"], [n], "ranked", 6);
    await ops.startCategory(id, cats[0], { random: rand });
    await playCategory(id, cats[0], n, "random", rand, `n=${n} ranked`);
    await storage.deleteTournament(id);
    runs++;
  }
  console.log(`   ${runs} tournaments played`);
}

async function testSeeding() {
  console.log("2. Seeding");
  expect(JSON.stringify(seedOrder(8)) === "[1,8,4,5,2,7,3,6]", "seed order for 8 is wrong");
  // Ranked, 8 players, favourites always win: final must be seed 1 v seed 2.
  const { id, cats } = await makeTournament(["A"], [8], "ranked");
  await ops.startCategory(id, cats[0]);
  const ps = await storage.getParticipants(id);
  const seedOf = new Map(ps.map(p => [p.id, p.seed]));
  let wr1 = (await storage.getMatches(id)).filter(m => m.bracket === "winners" && m.round === 1);
  expect(wr1.every(m => seedOf.get(m.participant1Id!)! + seedOf.get(m.participant2Id!)! === 9), "ranked first round should pair seeds summing to 9");
  for (;;) {
    const playable = (await storage.getMatches(id)).filter(m => m.bracket === "winners" && isReadyMatch(m));
    if (!playable.length) break;
    const m = playable[0];
    await ops.recordWinner(m.id, seedOf.get(m.participant1Id!)! < seedOf.get(m.participant2Id!)! ? m.participant1Id! : m.participant2Id!);
  }
  const final = (await storage.getMatches(id)).find(m => m.bracket === "winners" && m.round === 3)!;
  const finalists = [seedOf.get(final.participant1Id!), seedOf.get(final.participant2Id!)].sort();
  expect(JSON.stringify(finalists) === "[1,2]", `ranked winners final should be seed 1 v 2, got ${finalists}`);
  await storage.deleteTournament(id);

  // Sequential, 5 players: the chosen player gets the bye; ranked: top seeds get byes.
  const a = await makeTournament(["A"], [5], "sequential");
  const five = await storage.getParticipants(a.id);
  await ops.startCategory(a.id, a.cats[0], { byeRecipientId: five[1].id });
  wr1 = (await storage.getMatches(a.id)).filter(m => m.bracket === "winners" && m.round === 1);
  const byes = wr1.filter(m => m.winnerId && !isRealMatch(m));
  expect(byes.length === 1 && byes[0].winnerId === five[1].id, "sequential: the spin-wheel pick should be the one bye");
  await storage.deleteTournament(a.id);

  const b = await makeTournament(["A"], [5], "ranked");
  await ops.startCategory(b.id, b.cats[0]);
  const five2 = await storage.getParticipants(b.id);
  wr1 = (await storage.getMatches(b.id)).filter(m => m.bracket === "winners" && m.round === 1);
  const byeSeeds = wr1.filter(m => m.winMethod === "bye").map(m => five2.find(p => p.id === m.winnerId)!.seed).sort();
  expect(JSON.stringify(byeSeeds) === "[1,2,3]", `ranked: byes should go to seeds 1-3, got ${byeSeeds}`);
  await storage.deleteTournament(b.id);
}

const normalise = (rows: Match[]) => JSON.stringify([...rows].sort((x, y) => x.id.localeCompare(y.id))
  .map(m => [m.id, m.participant1Id, m.participant2Id, m.winnerId, m.participant1Fouls, m.participant2Fouls, m.winMethod]));

async function testUndo() {
  console.log("3. Undo and rewind");
  for (let n = 3; n <= 24; n += 3) {
    const rand = rng(900 + n);
    const { id, cats } = await makeTournament(["A"], [n], n % 2 ? "sequential" : "ranked", 2);
    await ops.startCategory(id, cats[0], { random: rand });
    const states: string[] = [normalise(await storage.getMatches(id))];
    // Play to the end, remembering the bracket after every action.
    for (;;) {
      const playable = (await storage.getMatches(id)).filter(isReadyMatch);
      if (!playable.length) break;
      const m = playable[Math.floor(rand() * playable.length)];
      if (rand() < 0.2) await ops.recordFoul(m.id, m.participant1Id!);
      else await ops.recordWinner(m.id, rand() < 0.5 ? m.participant1Id! : m.participant2Id!);
      states.push(normalise(await storage.getMatches(id)));
    }
    expect((await storage.getTournament(id))!.status === "completed", `undo n=${n}: should be completed before undo`);
    // Undo one step at a time, all the way back (history keeps the last 40 actions).
    const steps = Math.min(states.length - 1, 40);
    for (let i = 1; i <= steps; i++) {
      await ops.undoLast(id, cats[0]);
      expect(normalise(await storage.getMatches(id)) === states[states.length - 1 - i], `undo n=${n}: state after ${i} undo(s) differs from the original`);
      await checkCallSheet(id, `undo n=${n} step ${i}`);
    }
    expect((await storage.getTournament(id))!.status === "active", `undo n=${n}: status should return to active`);
    // Replay to the end again after undoing.
    await playCategory(id, cats[0], n, "random", rand, `replay after undo n=${n}`).catch(() => expect(false, `undo n=${n}: replay threw`));
    // Rewind several results in one go.
    const events = await ops.listEvents(id);
    if (events.length >= 4) {
      await ops.undoTo(id, events[3].id);
      expect((await ops.listEvents(id)).length === events.length - 4, `undo n=${n}: rewind should drop 4 events`);
    }
    await storage.deleteTournament(id);
  }
}

async function testMultiCategory() {
  console.log("4. Several classes, Champion of Champions, tables, linked athletes");
  for (let classes = 2; classes <= 13; classes++) {
    const rand = rng(77 + classes);
    const names = Array.from({ length: classes }, (_, i) => `C${i + 1}`);
    const counts = names.map((_, i) => 2 + ((i * 3 + classes) % 7));
    const { id, cats } = await makeTournament(names, counts, "sequential", 3);
    for (const cat of cats) await ops.startCategory(id, cat, { random: rand });
    for (let c = 0; c < cats.length; c++) await playCategory(id, cats[c], counts[c], "by-number", rand, `multi ${classes} classes / ${cats[c]}`);
    expect((await storage.getTournament(id))!.status === "awaiting_coc", `${classes} classes: expected awaiting_coc`);
    await ops.startCoc(id);
    expect((await storage.getTournament(id))!.status === "finals", `${classes} classes: expected finals`);
    let cocPlayed = 0;
    for (let guard = 0; guard < 40; guard++) {
      const playable = (await storage.getMatches(id)).filter(isReadyMatch);
      if (!playable.length) break;
      await checkCallSheet(id, `coc ${classes}`);
      await ops.recordWinner(playable[0].id, rand() < 0.5 ? playable[0].participant1Id! : playable[0].participant2Id!);
      cocPlayed++;
    }
    expect((await storage.getTournament(id))!.status === "completed", `Champion of Champions with ${classes} champions did not finish`);
    expect(cocPlayed === classes - 1, `Champion of Champions with ${classes} champions: ${cocPlayed} matches, expected ${classes - 1}`);
    // Undo the CoC final, then the status must go back to finals.
    await ops.undoLast(id, "__coc");
    expect((await storage.getTournament(id))!.status === "finals", `${classes} classes: undo of CoC final should return to finals`);
    await storage.deleteTournament(id);
  }

  // One athlete in two classes must never be on two tables at once.
  const t = await storage.createTournament({ name: "linked", size: 128, weightCategories: [], weightClasses: [WC("L"), WC("R")], email: "" });
  await storage.updateTournamentSettings(t.id, { tableCount: 4 });
  const [left, right] = t.weightCategories!;
  await ops.addAthletes(t.id, ["Asha", "Bela", "Chitra", "Deepa"].map(name => ({ name, club: "Iron Arms" })), [left, right]);
  await ops.addAthletes(t.id, [{ name: "asha" }, { name: "Esha" }], [left]);
  const entries = await storage.getParticipants(t.id);
  expect(entries.length === 9, `bulk add: expected 9 entries (duplicate skipped), got ${entries.length}`);
  expect(new Set(entries.filter(p => p.name === "Asha").map(p => p.athleteId)).size === 1, "bulk add: both Asha entries should share one athlete id");
  await ops.startCategory(t.id, left);
  await ops.startCategory(t.id, right);
  const rand = rng(5);
  for (let guard = 0; guard < 60; guard++) {
    await checkCallSheet(t.id, "linked athletes");
    const onTable = (await storage.getMatches(t.id)).filter(m => isReadyMatch(m) && m.tableNumber != null);
    if (!onTable.length) break;
    await ops.recordWinner(onTable[0].id, rand() < 0.5 ? onTable[0].participant1Id! : onTable[0].participant2Id!);
  }
  expect((await storage.getTournament(t.id))!.status === "awaiting_coc", "linked athletes: playing only table matches should finish both classes");
  await storage.deleteTournament(t.id);
}

(async () => {
  const started = Date.now();
  await testBrackets();
  await testSeeding();
  await testUndo();
  await testMultiCategory();
  console.log(`\n${checks - failures}/${checks} checks passed in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  if (failures) { console.error(`${failures} FAILED`); process.exit(1); }
  console.log("All bracket simulations passed.");
})().catch(err => { console.error(err); process.exit(1); });
