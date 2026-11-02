import { createDb } from "@/db";
import { migrateDb } from "@/db/migrate";
import { seed } from "@/db/seed";

/** Fresh in-memory database with migrations and seed data, one per test file. */
export async function testDb(now = new Date("2026-11-02T10:00:00+05:30")) {
  const { db, client } = createDb(":memory:");
  await migrateDb(db);
  const ids = await seed(db, now);
  return { db, client, ...ids };
}
