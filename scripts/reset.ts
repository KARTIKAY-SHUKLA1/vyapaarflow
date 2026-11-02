import { createDb, databaseUrl } from "../src/db";
import { assertWipeAllowed } from "../src/db/config";
import { migrateDb } from "../src/db/migrate";
import { seed } from "../src/db/seed";

/** Migrate + wipe + seed. Used for local setup and for refreshing the demo database. */
async function main() {
  // Wipes every table: a remote database needs --allow-remote-wipe or ALLOW_REMOTE_WIPE=true.
  assertWipeAllowed(databaseUrl());
  const { db, client } = createDb();
  await migrateDb(db);
  const { skuIds, retailerIds, history } = await seed(db);
  client.close();
  console.log(`Reset ${databaseUrl().replace(/\?.*$/, "")}: ${skuIds.size} SKUs, ${retailerIds.size} retailers, ${history.orders} historical orders (${history.lines} lines)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
