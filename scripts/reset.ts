import { createDb, databaseUrl } from "../src/db";
import { migrateDb } from "../src/db/migrate";
import { seed } from "../src/db/seed";

/** Migrate + wipe + seed. Used for local setup and for refreshing the demo database. */
async function main() {
  const { db, client } = createDb();
  await migrateDb(db);
  const { skuIds, retailerIds } = await seed(db);
  client.close();
  console.log(`Reset ${databaseUrl().replace(/\?.*$/, "")}: ${skuIds.size} SKUs, ${retailerIds.size} retailers`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
