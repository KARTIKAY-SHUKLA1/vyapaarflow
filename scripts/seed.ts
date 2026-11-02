import { createDb, databaseUrl } from "../src/db";
import { assertWipeAllowed } from "../src/db/config";
import { seed } from "../src/db/seed";

async function main() {
  // Wipes every table: a remote database needs --allow-remote-wipe or ALLOW_REMOTE_WIPE=true.
  assertWipeAllowed(databaseUrl());
  const { db, client } = createDb();
  const { skuIds, retailerIds, history } = await seed(db);
  client.close();
  console.log(`Seeded ${databaseUrl().replace(/\?.*$/, "")}: ${skuIds.size} SKUs, ${retailerIds.size} retailers, ${history.orders} historical orders (${history.lines} lines)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
