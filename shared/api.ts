// The application's API, independent of how requests arrive.
//
// `createApi(...).handle({ method, path, body, userId })` answers every
// tournament endpoint with `{ status, json }`. The Express server calls it for
// HTTP requests; the offline app calls it directly, with no network at all.
// (Login/sessions and the live-update streams are transport-specific and live
// with each transport.)
import { z } from "zod";
import type { Participant, TournamentWithDetails, PublicTournament } from "./schema";
import type { IStorage } from "./storage";
import { OpError, type Ops } from "./ops";
import { MAX_TABLES } from "./constants";
import { insertTournamentSchema, seedingModeEnum, weightClassLabel, weightClassSchema } from "./validation";
import { computeAthleteHistory } from "./stats";

export interface ApiRequest {
  method: string;
  /** Path without query string, e.g. "/api/tournaments/abc/undo". */
  path: string;
  body?: any;
  /** The signed-in organiser, if any. */
  userId?: string | null;
}

export interface ApiResponse {
  status: number;
  json: unknown;
}

export interface EmailStatus { sent: boolean; email?: string; error?: string }

export interface ApiDeps {
  storage: IStorage;
  ops: Ops;
  /** Sends the results email when a tournament completes. Leave out where email is unavailable (offline). */
  sendResultsEmail?: (tournamentId: string) => Promise<EmailStatus>;
  /** Number of spectators connected to a tournament's live stream. */
  viewerCount?: (tournamentId: string) => number;
}

interface Ctx {
  params: Record<string, string>;
  body: any;
  userId: string;
}

type Handler = (ctx: Ctx) => Promise<ApiResponse>;

interface Route {
  method: string;
  segments: string[];
  /** Public routes need no signed-in user. */
  open: boolean;
  handler: Handler;
}

const ok = (json: unknown, status = 200): ApiResponse => ({ status, json });
const fail = (status: number, message: string): ApiResponse => ({ status, json: { message } });

export function createApi({ storage, ops, sendResultsEmail, viewerCount }: ApiDeps) {
  const routes: Route[] = [];
  const add = (method: string, path: string, handler: Handler, open = false) => {
    routes.push({ method, segments: path.split("/").filter(Boolean), open, handler });
  };

  // ---- shared helpers ---------------------------------------------------------

  async function ownedTournament(userId: string, tournamentId: string) {
    const tournament = await storage.getTournament(tournamentId);
    if (!tournament) throw new OpError(404, "Tournament not found");
    if (tournament.userId && tournament.userId !== userId) throw new OpError(403, "Access denied");
    return tournament;
  }

  async function ownedParticipant(ctx: Ctx): Promise<Participant> {
    const participant = await storage.getParticipant(ctx.params.id);
    if (!participant) throw new OpError(404, "Participant not found");
    await ownedTournament(ctx.userId, participant.tournamentId);
    return participant;
  }

  async function ownedMatch(ctx: Ctx) {
    const match = await storage.getMatch(ctx.params.matchId);
    if (!match) throw new OpError(404, "Match not found");
    await ownedTournament(ctx.userId, match.tournamentId);
    return match;
  }

  async function details(tid: string): Promise<TournamentWithDetails> {
    const d = await storage.getTournamentWithDetails(tid);
    if (!d) throw new OpError(404, "Tournament not found");
    return d;
  }

  function toPublic(d: TournamentWithDetails): PublicTournament {
    const { email, userId, shareToken, ...rest } = d;
    return rest;
  }

  async function withEmailOnCompletion(tid: string, completedNow: boolean) {
    const d = await details(tid);
    if (!completedNow || !sendResultsEmail) return d;
    return { ...d, emailStatus: await sendResultsEmail(tid) };
  }

  /** Route for a tournament the caller must own; the handler receives it. */
  const owned = (method: string, path: string, handler: (ctx: Ctx, tournament: Awaited<ReturnType<typeof ownedTournament>>) => Promise<ApiResponse>) =>
    add(method, path, async ctx => handler(ctx, await ownedTournament(ctx.userId, ctx.params.id)));

  // ---- tournaments -------------------------------------------------------------

  add("GET", "/api/tournaments", async ctx => ok(await storage.getTournaments(ctx.userId)));

  owned("GET", "/api/tournaments/:id", async ctx => ok(await details(ctx.params.id)));

  add("POST", "/api/tournaments", async ctx => {
    const result = insertTournamentSchema.safeParse(ctx.body);
    if (!result.success) return fail(400, "Invalid data");
    if (result.data.size < 2 || result.data.size > 128) return fail(400, "Size must be between 2 and 128");
    if (!result.data.weightClasses || result.data.weightClasses.length < 1) {
      return fail(400, "At least one weight class is required");
    }
    return ok(await storage.createTournament(result.data, ctx.userId), 201);
  });

  owned("DELETE", "/api/tournaments/:id", async ctx => {
    await storage.deleteTournament(ctx.params.id);
    return ok({ success: true });
  });

  owned("POST", "/api/tournaments/:id/weight-classes", async (ctx, tournament) => {
    if (tournament.status !== "setup") return fail(400, "Cannot modify after bracket is started");
    const result = weightClassSchema.safeParse(ctx.body);
    if (!result.success) return fail(400, "Invalid weight class data");
    if ((tournament.weightCategories ?? []).includes(weightClassLabel(result.data))) {
      return fail(400, "This weight class already exists");
    }
    await storage.updateTournamentWeightClasses(tournament.id, [...(tournament.weightClasses ?? []), result.data]);
    return ok(await details(tournament.id));
  });

  owned("PATCH", "/api/tournaments/:id/email", async ctx => {
    const result = z.object({ email: z.string().email() }).safeParse(ctx.body);
    if (!result.success) return fail(400, "Valid email required");
    return ok(await storage.updateTournamentEmail(ctx.params.id, result.data.email));
  });

  owned("PATCH", "/api/tournaments/:id/settings", async ctx => {
    const result = z.object({
      tableCount: z.number().int().min(1).max(MAX_TABLES).optional(),
      autoTables: z.boolean().optional(),
      seedingMode: seedingModeEnum.optional(),
    }).safeParse(ctx.body);
    if (!result.success) return fail(400, `Tables must be 1-${MAX_TABLES}; seeding must be sequential, ranked or random`);
    await ops.updateSettings(ctx.params.id, result.data);
    return ok(await details(ctx.params.id));
  });

  // ---- live view -----------------------------------------------------------------

  owned("POST", "/api/tournaments/:id/share", async ctx => {
    const result = z.object({ enabled: z.boolean() }).safeParse(ctx.body);
    if (!result.success) return fail(400, "enabled must be true or false");
    return ok({ shareToken: await ops.setSharing(ctx.params.id, result.data.enabled) });
  });

  add("GET", "/api/public/:token", async ctx => {
    const tournament = await storage.getTournamentByShareToken(ctx.params.token);
    if (!tournament) return fail(404, "This live link is not active");
    return ok(toPublic(await details(tournament.id)));
  }, true);

  // ---- participants --------------------------------------------------------------

  owned("POST", "/api/tournaments/:id/participants", async (ctx, tournament) => {
    const result = z.object({
      name: z.string().trim().min(1, "Name is required"),
      weightCategory: z.string().optional(),
      club: z.string().trim().max(80).optional(),
    }).safeParse(ctx.body);
    if (!result.success) return fail(400, "Name is required");

    const hasCategories = (tournament.weightCategories ?? []).length > 0;
    if (hasCategories && !result.data.weightCategory) return fail(400, "Weight category is required");
    const { added } = await ops.addAthletes(
      tournament.id,
      [{ name: result.data.name, club: result.data.club }],
      [hasCategories ? result.data.weightCategory! : null],
      { allowDuplicateNames: true },
    );
    if (!added) return fail(400, `Category is full (max ${tournament.size} per category)`);
    return ok({ added }, 201);
  });

  owned("POST", "/api/tournaments/:id/participants/bulk", async ctx => {
    const result = z.object({
      entries: z.array(z.object({ name: z.string().max(120), club: z.string().max(80).nullish() })).min(1).max(500),
      weightCategories: z.array(z.string()).max(64).default([]),
    }).safeParse(ctx.body);
    if (!result.success) return fail(400, "Send a list of names and at least one weight class");
    const outcome = await ops.addAthletes(ctx.params.id, result.data.entries, result.data.weightCategories);
    return ok({ ...outcome, tournament: await details(ctx.params.id) }, 201);
  });

  owned("POST", "/api/tournaments/:id/participants/reorder", async ctx => {
    const result = z.object({
      weightCategory: z.string().nullable(),
      orderedIds: z.array(z.string()).min(1),
    }).safeParse(ctx.body);
    if (!result.success) return fail(400, "orderedIds required");
    const tid = ctx.params.id;
    if (ops.categoryStarted(await storage.getMatches(tid), result.data.weightCategory)) {
      return fail(400, "Seeds are locked once the bracket has started");
    }
    await ops.renumberSeeds(tid, result.data.weightCategory, result.data.orderedIds);
    return ok(await details(tid));
  });

  add("PATCH", "/api/participants/:id", async ctx => {
    const result = z.object({
      name: z.string().trim().min(1).optional(),
      club: z.string().trim().max(80).nullable().optional(),
    }).safeParse(ctx.body);
    if (!result.success || (result.data.name === undefined && result.data.club === undefined)) {
      return fail(400, "Name is required");
    }
    const participant = await ownedParticipant(ctx);
    const updates = { ...result.data, club: result.data.club === "" ? null : result.data.club };
    // The same person entered in several classes stays in sync.
    for (const entry of await ops.linkedEntries(participant)) {
      await storage.updateParticipant(entry.id, updates);
    }
    return ok(await storage.getParticipant(participant.id));
  });

  add("POST", "/api/participants/:id/photo", async ctx => {
    const result = z.object({ photoData: z.string().min(1) }).safeParse(ctx.body);
    if (!result.success) return fail(400, "photoData required");
    const participant = await ownedParticipant(ctx);
    for (const entry of await ops.linkedEntries(participant)) {
      await storage.updateParticipantPhoto(entry.id, result.data.photoData);
    }
    return ok(await storage.getParticipant(participant.id));
  });

  add("DELETE", "/api/participants/:id/photo", async ctx => {
    const participant = await ownedParticipant(ctx);
    for (const entry of await ops.linkedEntries(participant)) {
      await storage.updateParticipantPhoto(entry.id, null);
    }
    return ok(await storage.getParticipant(participant.id));
  });

  add("DELETE", "/api/participants/:id", async ctx => {
    const participant = await ownedParticipant(ctx);
    const matches = await storage.getMatches(participant.tournamentId);
    if (ops.categoryStarted(matches, participant.weightCategory)) {
      return fail(400, "Cannot remove a participant after their bracket has started");
    }
    await storage.deleteParticipant(participant.id);
    await ops.renumberSeeds(participant.tournamentId, participant.weightCategory);
    return ok({ success: true });
  });

  // ---- starting, resetting -------------------------------------------------------

  owned("POST", "/api/tournaments/:id/start-category", async ctx => {
    const result = z.object({ category: z.string().min(1), byeRecipientId: z.string().optional() }).safeParse(ctx.body);
    if (!result.success) return fail(400, "category is required");
    await ops.startCategory(ctx.params.id, result.data.category, { byeRecipientId: result.data.byeRecipientId });
    return ok(await details(ctx.params.id));
  });

  owned("POST", "/api/tournaments/:id/start", async (ctx, tournament) => {
    const tid = tournament.id;
    const byeRecipients: Record<string, string> = ctx.body?.byeRecipients || {};
    const categories: string[] = tournament.weightCategories ?? [];

    if (categories.length) {
      const matches = await storage.getMatches(tid);
      const participants = await storage.getParticipants(tid);
      const unstarted = categories.filter(cat => !ops.categoryStarted(matches, cat));
      for (const cat of unstarted) {
        if (participants.filter(p => p.weightCategory === cat).length < 2) {
          return fail(400, `Need at least 2 participants in "${cat}" category`);
        }
      }
      for (const cat of unstarted) await ops.startCategory(tid, cat, { byeRecipientId: byeRecipients[cat] });
    } else {
      await ops.startCategory(tid, null, { byeRecipientId: byeRecipients["__default"] });
    }
    return ok(await details(tid));
  });

  owned("POST", "/api/tournaments/:id/reset", async ctx => {
    await ops.resetTournament(ctx.params.id);
    return ok(await details(ctx.params.id));
  });

  owned("POST", "/api/tournaments/:id/restart-category", async ctx => {
    const result = z.object({ category: z.string().nullable() }).safeParse(ctx.body);
    if (!result.success) return fail(400, "category is required");
    await ops.restartCategory(ctx.params.id, result.data.category);
    return ok(await details(ctx.params.id));
  });

  owned("POST", "/api/tournaments/:id/start-coc", async ctx => {
    await ops.startCoc(ctx.params.id, ctx.body?.byeRecipientId);
    return ok(await details(ctx.params.id));
  });

  owned("POST", "/api/tournaments/:id/skip-coc", async ctx => {
    await ops.skipCoc(ctx.params.id);
    return ok(await withEmailOnCompletion(ctx.params.id, true));
  });

  // ---- undo history ----------------------------------------------------------------

  owned("GET", "/api/tournaments/:id/events", async ctx => {
    const tid = ctx.params.id;
    return ok({ events: await ops.listEvents(tid), viewers: viewerCount?.(tid) ?? 0 });
  });

  owned("POST", "/api/tournaments/:id/undo", async ctx => {
    const result = z.object({ eventId: z.string().optional(), scope: z.string().optional() }).safeParse(ctx.body);
    if (!result.success || (!result.data.eventId && !result.data.scope)) return fail(400, "eventId or scope required");
    const tid = ctx.params.id;
    if (result.data.eventId) await ops.undoTo(tid, result.data.eventId);
    else await ops.undoLast(tid, result.data.scope!);
    return ok(await details(tid));
  });

  // ---- matches -----------------------------------------------------------------------

  add("POST", "/api/matches/:matchId/foul", async ctx => {
    const result = z.object({ participantId: z.string() }).safeParse(ctx.body);
    if (!result.success) return fail(400, "participantId required");
    const match = await ownedMatch(ctx);
    const outcome = await ops.recordFoul(match.id, result.data.participantId);
    return ok(await withEmailOnCompletion(match.tournamentId, outcome.completedNow));
  });

  add("POST", "/api/matches/:matchId/winner", async ctx => {
    const result = z.object({ winnerId: z.string() }).safeParse(ctx.body);
    if (!result.success) return fail(400, "winnerId required");
    const match = await ownedMatch(ctx);
    const outcome = await ops.recordWinner(match.id, result.data.winnerId);
    return ok(await withEmailOnCompletion(match.tournamentId, outcome.completedNow));
  });

  add("POST", "/api/matches/:matchId/table", async ctx => {
    const result = z.object({ tableNumber: z.number().int().min(1).max(MAX_TABLES).nullable() }).safeParse(ctx.body);
    if (!result.success) return fail(400, "tableNumber must be a table number or null");
    const match = await ownedMatch(ctx);
    await ops.setMatchTable(match.id, result.data.tableNumber);
    return ok(await details(match.tournamentId));
  });

  // ---- athlete records across all of this organiser's tournaments -----------------

  add("GET", "/api/athletes", async ctx => {
    const tournaments = await storage.getTournaments(ctx.userId);
    const all: TournamentWithDetails[] = [];
    for (const t of tournaments) {
      const d = await storage.getTournamentWithDetails(t.id);
      if (d) all.push(d);
    }
    return ok(computeAthleteHistory(all));
  });

  // ---- dispatch ----------------------------------------------------------------------

  function match(method: string, path: string): { route: Route; params: Record<string, string> } | null {
    const parts = path.split("?")[0].split("/").filter(Boolean);
    for (const route of routes) {
      if (route.method !== method || route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let matched = true;
      for (let i = 0; i < parts.length; i++) {
        const seg = route.segments[i];
        if (seg.startsWith(":")) params[seg.slice(1)] = decodeURIComponent(parts[i]);
        else if (seg !== parts[i]) { matched = false; break; }
      }
      if (matched) return { route, params };
    }
    return null;
  }

  /** Answers the request, or returns null when the path is not one of this API's routes. */
  async function handle(req: ApiRequest): Promise<ApiResponse | null> {
    const found = match(req.method.toUpperCase(), req.path);
    if (!found) return null;
    if (!found.route.open && !req.userId) return fail(401, "Authentication required");
    try {
      return await found.route.handler({ params: found.params, body: req.body ?? {}, userId: req.userId ?? "" });
    } catch (err) {
      if (err instanceof OpError) return fail(err.status, err.message);
      throw err;
    }
  }

  return { handle };
}
