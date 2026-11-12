import type { Express } from "express";
import { type Server } from "http";
import { storage } from "./storage";
import { requireAuth } from "./auth";
import { createApi } from "@shared/api";
import { sendResultsEmail } from "./email";
import { subscribe, viewerCount } from "./live";
import { ops } from "./ops";

// All tournament endpoints live in shared/api.ts (the offline app uses the
// very same handlers). This file only connects them to HTTP and adds the two
// live-update streams, which need a real connection.
const api = createApi({ storage, ops, sendResultsEmail, viewerCount });

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  app.get("/api/tournaments/:id/stream", requireAuth, async (req, res) => {
    const tournament = await storage.getTournament(String(req.params.id));
    if (!tournament) return res.status(404).json({ message: "Tournament not found" });
    if (tournament.userId && tournament.userId !== req.session.userId) {
      return res.status(403).json({ message: "Access denied" });
    }
    subscribe(tournament.id, res);
  });

  app.get("/api/public/:token/stream", async (req, res) => {
    const tournament = await storage.getTournamentByShareToken(String(req.params.token));
    if (!tournament) return res.status(404).json({ message: "This live link is not active" });
    subscribe(tournament.id, res, "spectator");
  });

  app.use(async (req, res, next) => {
    if (!req.path.startsWith("/api/")) return next();
    const out = await api.handle({ method: req.method, path: req.path, body: req.body, userId: req.session.userId });
    if (!out) return next();
    res.status(out.status).json(out.json);
  });

  return httpServer;
}
