import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

// With DATABASE_URL set the app uses PostgreSQL (the normal, persistent mode).
// Without it the app falls back to in-memory storage: handy for trying things
// out locally and for the bracket simulations, but data is lost on restart.
export const hasDatabase = !!process.env.DATABASE_URL;

export const pool: pg.Pool = hasDatabase
  ? new pg.Pool({ connectionString: process.env.DATABASE_URL })
  : (null as unknown as pg.Pool);

export const db = hasDatabase
  ? drizzle(pool, { schema })
  : (null as unknown as ReturnType<typeof drizzle<typeof schema>>);
