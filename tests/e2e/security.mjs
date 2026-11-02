// Security boundaries over real HTTP: role areas, cross-retailer data, desk-only CSV, real 404s.
import { createClient } from "@libsql/client";
import { BASE, Checks, login, newPage } from "./lib.mjs";

const db = process.env.E2E_BASE_URL ? null : createClient({ url: "file:./data/e2e.db" });

export default async function security(browser) {
  const c = new Checks("security");
  const anyId = async (sql) => (db ? String((await db.execute(sql)).rows[0]?.id ?? "") : "");
  const otherShopsOrder = await anyId("select o.id from orders o join retailers r on r.id = o.retailer_id where r.code = 'RT-1009' limit 1");
  const exportId = await anyId("select id from tally_exports limit 1");

  // Signed out
  const anon = await newPage(browser);
  for (const p of ["/shop", "/shop/orders", "/desk", "/desk/inbox"]) {
    await anon.goto(`${BASE}${p}`, { waitUntil: "networkidle0" });
    c.eq(`signed out ${p} → login`, new URL(anon.url()).pathname, "/login");
  }
  if (exportId) {
    await anon.goto(`${BASE}/desk/export/${exportId}`, { waitUntil: "networkidle0" });
    c.eq("signed out CSV download → login", new URL(anon.url()).pathname, "/login");
  }

  // A retailer
  const shop = await newPage(browser);
  await login(shop, "9000000001", "/shop");
  for (const p of ["/desk", "/desk/orders", "/desk/inbox", "/desk/export"]) {
    await shop.goto(`${BASE}${p}`, { waitUntil: "networkidle0" });
    c.eq(`retailer ${p} → bounced to /shop`, new URL(shop.url()).pathname, "/shop");
  }
  if (exportId) {
    const r = await shop.goto(`${BASE}/desk/export/${exportId}`, { waitUntil: "networkidle0" });
    c.eq("retailer cannot download the Tally CSV (404)", r.status(), 404);
  }
  if (otherShopsOrder) {
    const r = await shop.goto(`${BASE}/shop/orders/${otherShopsOrder}`, { waitUntil: "networkidle0" });
    c.eq("another shop's order is a real 404", r.status(), 404);
    const body = await shop.evaluate(() => document.body.innerText);
    c.ok("…and reveals nothing about it", body.includes("Page not found") && !body.includes("Agrawal"));
  }
  const missingProduct = await shop.goto(`${BASE}/shop/p/SKU-NOPE-1`, { waitUntil: "networkidle0" });
  c.eq("unknown product is a real 404", missingProduct.status(), 404);

  // The desk
  const desk = await newPage(browser, { width: 1280, height: 900, mobile: false });
  await login(desk, "9000000100", "/desk");
  for (const p of ["/desk/orders/does-not-exist", "/desk/inbox/does-not-exist"]) {
    const r = await desk.goto(`${BASE}${p}`, { waitUntil: "networkidle0" });
    c.eq(`desk ${p} is a real 404`, r.status(), 404);
  }
  await desk.goto(`${BASE}/shop`, { waitUntil: "networkidle0" });
  c.eq("desk user cannot use the retailer shop", new URL(desk.url()).pathname, "/desk");

  // Forged session cookie
  const forged = await newPage(browser);
  await forged.setCookie({ name: "vf_session", value: "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiZGVzayIsInN1YiI6IngifQ.forged", url: BASE });
  await forged.goto(`${BASE}/desk`, { waitUntil: "networkidle0" });
  c.eq("forged session cookie → login", new URL(forged.url()).pathname, "/login");

  // Manifest (installable web app)
  const manifest = await anon.evaluate(async (u) => (await fetch(u)).json(), `${BASE}/manifest.webmanifest`);
  c.ok("web app manifest with icons", manifest.display === "standalone" && manifest.icons?.length >= 2);

  db?.close();
  return c;
}
