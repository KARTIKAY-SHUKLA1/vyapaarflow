import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { databaseConfig } from "./config";
import * as schema from "./schema";

export type DB = LibSQLDatabase<typeof schema>;

/**
 * Local default: a SQLite file. Production: a Turso URL (libsql://…) plus auth token,
 * validated by databaseConfig() (throws with a clear message when misconfigured).
 */
export function databaseUrl(): string {
  return databaseConfig().url;
}

/** No arguments: the validated configuration. An explicit URL (tests) is used as given. */
export function createDb(url?: string, authToken?: string): { db: DB; client: Client } {
  const config = url === undefined ? databaseConfig() : { url, authToken: authToken ?? process.env.DATABASE_AUTH_TOKEN };
  const client = createClient({ url: config.url, authToken: config.authToken });
  return { db: drizzle(client, { schema }), client };
}

// Reuse one client across hot reloads in dev.
const globalForDb = globalThis as unknown as { __vfDb?: DB };

export const db: DB = globalForDb.__vfDb ?? createDb().db;
if (process.env.NODE_ENV !== "production") globalForDb.__vfDb = db;

export { schema };
