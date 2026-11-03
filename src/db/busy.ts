/**
 * SQLite allows one writer at a time. A write transaction (libSQL "write" mode =
 * BEGIN IMMEDIATE) that meets another one can fail with SQLITE_BUSY instead of
 * waiting; these helpers detect that and retry with backoff.
 */

const BUSY_RETRIES = 6;

export function isBusy(error: unknown): boolean {
  for (let e = error; e instanceof Error; e = (e as Error & { cause?: unknown }).cause) {
    if ((e as { code?: string }).code === "SQLITE_BUSY" || /database is locked/i.test(e.message)) return true;
  }
  return false;
}

/**
 * Retry `fn` while the database is busy. Callers must make `fn` safe to repeat
 * (e.g. an idempotency check or a conditional write at its start).
 */
export async function withBusyRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (!isBusy(error) || attempt >= BUSY_RETRIES) throw error;
      await new Promise((r) => setTimeout(r, 40 * 2 ** attempt + Math.random() * 40));
    }
  }
}
