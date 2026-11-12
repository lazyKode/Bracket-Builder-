import { pgTable, text, integer, varchar, timestamp, boolean, json } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export { MAX_TABLES, SCOPE_DEFAULT, SCOPE_COC } from "./constants";
export {
  seedingModeEnum, ageCategoryEnum, handEnum, genderEnum, weightClassSchema, weightClassLabel, insertTournamentSchema,
  type SeedingMode, type AgeCategory, type Hand, type Gender, type WeightClass, type InsertTournament,
} from "./validation";
import type { WeightClass } from "./validation";

export const sessionTable = pgTable("session", {
  sid: varchar("sid").primaryKey(),
  sess: json("sess").notNull(),
  expire: timestamp("expire", { precision: 6 }).notNull(),
});

export const users = pgTable("users", {
  id: varchar("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  email: text("email").notNull().default(""),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
  email: true,
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export const tournaments = pgTable("tournaments", {
  id: varchar("id").primaryKey(),
  name: text("name").notNull(),
  size: integer("size").notNull(),
  status: text("status").notNull().default("setup"),
  weightCategories: text("weight_categories").array().default([]),
  weightClassesJson: text("weight_classes_json").default("[]"),
  email: text("email").default(""),
  userId: varchar("user_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  // Public read-only spectator link. Null = sharing is off.
  shareToken: text("share_token"),
  // Number of competition tables matches can be called to.
  tableCount: integer("table_count").notNull().default(1),
  // When true, the next ready match is sent to a table as soon as one frees up.
  autoTables: boolean("auto_tables").notNull().default(true),
  // How players are placed when a bracket is generated.
  seedingMode: text("seeding_mode").notNull().default("sequential"),
});

export type Tournament = typeof tournaments.$inferSelect & {
  weightClasses?: WeightClass[];
};

export const participants = pgTable("participants", {
  id: varchar("id").primaryKey(),
  tournamentId: varchar("tournament_id").notNull(),
  name: text("name").notNull(),
  seed: integer("seed").notNull(),
  weightCategory: text("weight_category"),
  photoUrl: text("photo_url"),
  club: text("club"),
  // Entries that belong to the same person (e.g. left + right hand) share an athleteId.
  athleteId: varchar("athlete_id"),
});

export const insertParticipantSchema = createInsertSchema(participants).pick({
  tournamentId: true,
  name: true,
  seed: true,
}).extend({
  weightCategory: z.string().nullable().optional(),
});
export type InsertParticipant = z.infer<typeof insertParticipantSchema>;
export type Participant = typeof participants.$inferSelect;

export const matches = pgTable("matches", {
  id: varchar("id").primaryKey(),
  tournamentId: varchar("tournament_id").notNull(),
  bracket: text("bracket").notNull(),
  round: integer("round").notNull(),
  matchIndex: integer("match_index").notNull(),
  participant1Id: varchar("participant1_id"),
  participant2Id: varchar("participant2_id"),
  winnerId: varchar("winner_id"),
  weightCategory: text("weight_category"),
  participant1Fouls: integer("participant1_fouls").notNull().default(0),
  participant2Fouls: integer("participant2_fouls").notNull().default(0),
  // Call number, given once both players are known (tournament-wide, in call order).
  matchNumber: integer("match_number"),
  // Table the match is currently on (cleared when the match is decided).
  tableNumber: integer("table_number"),
  // "pin" | "fouls" | "bye"
  winMethod: text("win_method"),
  readyAt: timestamp("ready_at"),
  completedAt: timestamp("completed_at"),
});

// One row per recorded result or foul. `snapshot` holds the matches of that
// bracket as they were *before* the action, which is what makes undo exact.
export const matchEvents = pgTable("match_events", {
  id: varchar("id").primaryKey(),
  tournamentId: varchar("tournament_id").notNull(),
  scope: text("scope").notNull(),
  seq: integer("seq").notNull(),
  kind: text("kind").notNull(),
  matchId: varchar("match_id"),
  summary: text("summary").notNull(),
  snapshot: text("snapshot").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type MatchEvent = typeof matchEvents.$inferSelect;
export type MatchEventSummary = Omit<MatchEvent, "snapshot">;


export const insertMatchSchema = createInsertSchema(matches).pick({
  tournamentId: true,
  bracket: true,
  round: true,
  matchIndex: true,
  participant1Id: true,
  participant2Id: true,
}).extend({
  weightCategory: z.string().nullable().optional(),
});
export type InsertMatch = z.infer<typeof insertMatchSchema>;
export type Match = typeof matches.$inferSelect;

export type TournamentWithDetails = Tournament & {
  participants: Participant[];
  matches: Match[];
  weightClasses?: WeightClass[];
};

// What spectators receive: no owner details, no share token.
export type PublicTournament = Omit<TournamentWithDetails, "email" | "userId" | "shareToken">;
