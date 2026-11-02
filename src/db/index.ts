import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import * as schema from "./schema";

export type DB = LibSQLDatabase<typeof schema>;

/** Local default: a SQLite file. Production: a Turso URL (libsql://…) plus auth token. */
export function databaseUrl(): string {
  return process.env.DATABASE_URL ?? "file:./data/local.db";
}

export function createDb(url = databaseUrl(), authToken = process.env.DATABASE_AUTH_TOKEN): { db: DB; client: Client } {
  const client = createClient({ url, authToken });
  return { db: drizzle(client, { schema }), client };
}

// Reuse one client across hot reloads in dev.
const globalForDb = globalThis as unknown as { __vfDb?: DB };

export const db: DB = globalForDb.__vfDb ?? createDb().db;
if (process.env.NODE_ENV !== "production") globalForDb.__vfDb = db;

export { schema };
