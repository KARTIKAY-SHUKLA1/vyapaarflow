import { createDb, databaseUrl } from "../src/db";
import { seed } from "../src/db/seed";

async function main() {
  const { db, client } = createDb();
  const { skuIds, retailerIds } = await seed(db);
  client.close();
  console.log(`Seeded ${databaseUrl().replace(/\?.*$/, "")}: ${skuIds.size} SKUs, ${retailerIds.size} retailers`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
