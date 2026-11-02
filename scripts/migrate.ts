import { createDb, databaseUrl } from "../src/db";
import { migrateDb } from "../src/db/migrate";

async function main() {
  const { db, client } = createDb();
  await migrateDb(db);
  client.close();
  console.log(`Migrated ${databaseUrl().replace(/\?.*$/, "")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
