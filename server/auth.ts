import type { Express, Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPg from "connect-pg-simple";
import createMemoryStore from "memorystore";
import bcrypt from "bcrypt";
import { storage } from "./storage";
import { pool, hasDatabase } from "./db";

const PgSession = connectPg(session);
const MemoryStore = createMemoryStore(session);

declare module "express-session" {
  interface SessionData {
    userId: string;
  }
}

export function setupAuth(app: Express) {
  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret && process.env.NODE_ENV === "production") {
    console.warn("⚠️  WARNING: SESSION_SECRET not set in production. Using fallback secret. Set SESSION_SECRET environment variable for persistent sessions across server restarts.");
  }

  app.use(
    session({
      store: hasDatabase
        ? new PgSession({ pool: pool, createTableIfMissing: true })
        : new MemoryStore({ checkPeriod: 24 * 60 * 60 * 1000 }),
      secret: sessionSecret || "arm-wrestling-dev-secret",
      resave: false,
      saveUninitialized: false,
      cookie: {
        maxAge: 30 * 24 * 60 * 60 * 1000,
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
      },
    })
  );

  app.post("/api/auth/register", async (req: Request, res: Response) => {
    const { username, password, email } = req.body;
    if (!username || !password) return res.status(400).json({ message: "Username and password are required" });
    if (username.length < 3) return res.status(400).json({ message: "Username must be at least 3 characters" });
    if (password.length < 4) return res.status(400).json({ message: "Password must be at least 4 characters" });
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: "A valid email address is required" });

    const existing = await storage.getUserByUsername(username);
    if (existing) return res.status(400).json({ message: "Username already taken" });

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await storage.createUser({ username, password: hashedPassword, email });
    req.session.userId = user.id;
    req.session.save((err) => {
      if (err) return res.status(500).json({ message: "Session save failed" });
      res.status(201).json({ id: user.id, username: user.username, email: user.email });
    });
  });

  app.post("/api/auth/login", async (req: Request, res: Response) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ message: "Username and password are required" });

    const user = await storage.getUserByUsername(username);
    if (!user) return res.status(401).json({ message: "Invalid username or password" });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ message: "Invalid username or password" });

    req.session.userId = user.id;
    req.session.save((err) => {
      if (err) return res.status(500).json({ message: "Session save failed" });
      res.json({ id: user.id, username: user.username, email: user.email });
    });
  });

  app.post("/api/auth/logout", (req: Request, res: Response) => {
    req.session.destroy((err) => {
      if (err) return res.status(500).json({ message: "Failed to logout" });
      res.json({ success: true });
    });
  });

  app.get("/api/user", async (req: Request, res: Response) => {
    if (!req.session.userId) return res.status(401).json({ message: "Not authenticated" });
    const user = await storage.getUser(req.session.userId);
    if (!user) return res.status(401).json({ message: "Not authenticated" });
    res.json({ id: user.id, username: user.username, email: user.email });
  });
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) return res.status(401).json({ message: "Authentication required" });
  next();
}
