/**
 * Database connection settings, validated. Pure (no client import) so it can be tested.
 *
 * Development, tests and scripts: DATABASE_URL may be a local SQLite file and
 * defaults to file:./data/local.db.
 *
 * Production server (NODE_ENV=production): DATABASE_URL must be a remote libSQL/Turso
 * URL and DATABASE_AUTH_TOKEN must be set. Otherwise this throws with a clear message
 * instead of silently writing to a file on a temporary, read-only serverless disk.
 * Two exceptions:
 * - `next build` (NEXT_PHASE=phase-production-build) is not checked, so the app can
 *   be built without production credentials;
 * - ALLOW_LOCAL_DATABASE=true allows a local file, for running the production build
 *   on your own machine (the e2e suite does this).
 */

export const LOCAL_DEFAULT_URL = "file:./data/local.db";
const REMOTE_SCHEMES = new Set(["libsql:", "https:", "wss:"]);

type Env = Record<string, string | undefined>;

export type DatabaseConfig = { url: string; authToken: string | undefined };

export function databaseConfig(env: Env = process.env): DatabaseConfig {
  const url = env.DATABASE_URL?.trim() || undefined;
  const authToken = env.DATABASE_AUTH_TOKEN?.trim() || undefined;

  const enforce = env.NODE_ENV === "production" && env.NEXT_PHASE !== "phase-production-build" && env.ALLOW_LOCAL_DATABASE !== "true";
  if (!enforce) return { url: url ?? LOCAL_DEFAULT_URL, authToken };

  if (!url) {
    throw new Error("DATABASE_URL is not set. In production it must be the remote libSQL/Turso URL, e.g. libsql://<database>-<org>.turso.io. See deployment.md.");
  }
  if (!isRemoteDatabaseUrl(url)) {
    // Name only the scheme: the value itself may carry credentials.
    throw new Error(
      `DATABASE_URL must be a remote libSQL/Turso URL (libsql://, https:// or wss://) in production, not a "${schemeOf(url)}" URL. ` +
        "To run the production build against a local file on your own machine, set ALLOW_LOCAL_DATABASE=true. See deployment.md.",
    );
  }
  if (!authToken) {
    throw new Error("DATABASE_AUTH_TOKEN is not set. Production needs the Turso database token. See deployment.md.");
  }
  return { url, authToken };
}

/** A libsql://, https:// or wss:// URL with a host. Files and :memory: are local. */
export function isRemoteDatabaseUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return REMOTE_SCHEMES.has(u.protocol) && u.hostname.length > 0;
  } catch {
    return false;
  }
}

function schemeOf(url: string): string {
  if (url === ":memory:") return ":memory:";
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(url);
  return m ? `${m[1].toLowerCase()}:` : "unknown";
}

/**
 * db:seed and db:reset wipe every table. Against a remote database they run only
 * with an explicit opt-in: the --allow-remote-wipe flag or ALLOW_REMOTE_WIPE=true.
 * Local files and :memory: need no opt-in.
 */
export function assertWipeAllowed(url: string, opts: { argv?: readonly string[]; env?: Env } = {}): void {
  const argv = opts.argv ?? process.argv;
  const env = opts.env ?? process.env;
  const local = url === ":memory:" || /^file:/i.test(url.trim());
  if (local) return;
  if (argv.includes("--allow-remote-wipe") || env.ALLOW_REMOTE_WIPE === "true") return;
  let where = schemeOf(url);
  try {
    where = new URL(url).host || where; // host only: no path, query or credentials
  } catch {}
  throw new Error(
    `Refusing to wipe and re-seed a remote database (${where}). This deletes every order, export and audit row. ` +
      "If that is really what you want, re-run with --allow-remote-wipe (npm run db:reset -- --allow-remote-wipe) or ALLOW_REMOTE_WIPE=true.",
  );
}
