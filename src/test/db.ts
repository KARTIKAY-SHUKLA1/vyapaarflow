import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDb } from "@/db";
import { migrateDb } from "@/db/migrate";
import { seed } from "@/db/seed";

/**
 * Fresh migrated + seeded database in a temp file. A file (not :memory:) is used
 * because libsql gives in-memory databases a single connection, which would hide
 * real concurrency behaviour (e.g. two simultaneous order submissions).
 */
export async function testDb(now = new Date("2026-11-02T10:00:00+05:30")) {
  const dir = mkdtempSync(path.join(tmpdir(), "vf-test-"));
  const { db, client } = createDb(`file:${path.join(dir, "test.db").replace(/\\/g, "/")}`);
  await migrateDb(db);
  const ids = await seed(db, now);
  return { db, client, ...ids };
}
