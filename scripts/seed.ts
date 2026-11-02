import { createDb, databaseUrl } from "../src/db";
import { seed } from "../src/db/seed";

async function main() {
  const { db, client } = createDb();
  const { skuIds, retailerIds, history } = await seed(db);
  client.close();
  console.log(`Seeded ${databaseUrl().replace(/\?.*$/, "")}: ${skuIds.size} SKUs, ${retailerIds.size} retailers, ${history.orders} historical orders (${history.lines} lines)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
