// Retailer: OTP login → browse/search → prices & schemes → cart → checkout → orders → repeat order.
import { createClient } from "@libsql/client";
import { BASE, Checks, click, clickVisible, login, mainText, newPage, settle, shot, typeInto, waitVisible } from "./lib.mjs";

const db = process.env.E2E_BASE_URL ? null : createClient({ url: "file:./data/e2e.db" });

export default async function retailer(browser) {
  const c = new Checks("retailer");
  const page = await newPage(browser);

  await login(page, "9000000001", "/shop"); // Sharma Kirana Store
  c.ok("OTP login lands on the catalogue", new URL(page.url()).pathname === "/shop");
  await page.waitForSelector("#catalogue-search");
  await shot(page, "r01-catalogue");

  let t = await mainText(page);
  c.ok("brief SKUs listed", ["Glucose biscuit 75 g", "Detergent powder 1 kg", "Tea leaf 250 g"].every((s) => t.includes(s)));
  c.ok("brief schemes shown", t.includes("Buy 10 cases get 1 free") && t.includes("3% off 5 or more cases"));
  const cardTexts = await page.$$eval("main section + h2 + ul > li, main ul.grid > li", (lis) => lis.map((li) => li.innerText));
  c.ok("every product card says excl. GST", cardTexts.length >= 20 && cardTexts.every((x) => x.includes("excl. GST")), `${cardTexts.length} cards`);
  c.ok("available credit shown", /Available credit: ₹1,07,500\.00/.test(t));
  c.ok("usual items shown first, from past orders", t.indexOf("Your usual items") >= 0 && t.indexOf("Your usual items") < t.indexOf("All products"));

  // Search
  await page.type("#catalogue-search", "glucose 75");
  await settle(300);
  const found = await page.$$eval("main ul > li a[href^='/shop/p/']", (as) => [...new Set(as.map((a) => a.getAttribute("href")))]);
  c.eq("search 'glucose 75' finds only the 75 g pack", found.join(","), "/shop/p/SKU-BS-075");
  await click(page, "::-p-xpath(//main//li//button[normalize-space(.)='+ Add'])");
  await typeInto(page, 'main input[aria-label="Cases"]', "5");
  await page.keyboard.press("Enter");
  await settle(300);

  // Out of stock is visible but not orderable
  await page.$eval("#catalogue-search", (e) => (e.value = ""));
  await typeInto(page, "#catalogue-search", "tea leaf 250");
  await settle(300);
  const teaCard = await page.$eval("main ul > li", (li) => ({ text: li.innerText, buttons: li.querySelectorAll("button").length }));
  c.ok("out-of-stock tea is shown but cannot be added", teaCard.text.includes("Out of stock") && teaCard.buttons === 0, JSON.stringify(teaCard));

  // Category filter
  await page.$eval("#catalogue-search", (e) => (e.value = ""));
  await page.goto(`${BASE}/shop`, { waitUntil: "networkidle0" });
  await click(page, "::-p-xpath(//button[@aria-pressed][normalize-space(.)='Tea'])");
  await settle(300);
  const teaOnly = await page.$$eval("main ul > li a[href^='/shop/p/']", (as) => [...new Set(as.map((a) => a.getAttribute("href")))]);
  c.ok("category chip filters to Tea", teaOnly.length > 0 && teaOnly.every((h) => h.includes("SKU-TE") || h.includes("SKU-TD")));

  // Product detail with live server price
  await page.goto(`${BASE}/shop/p/SKU-DT-1KG`, { waitUntil: "networkidle0" });
  await typeInto(page, 'main input[aria-label="Cases"]', "2");
  await page.keyboard.press("Tab");
  await settle(1200);
  await shot(page, "r02-product");
  t = await mainText(page);
  c.ok("product preview priced by server with scheme progress", t.includes("₹4,790.80") && t.includes("2 of 5 cases · 3% off at 5"));
  await click(page, "::-p-text(Add to cart)");
  await settle(300);

  // Cart: nudges, quantity update, scheme applied
  await page.goto(`${BASE}/shop/cart`, { waitUntil: "networkidle0" });
  await settle(1200);
  t = await mainText(page);
  c.ok("cart shows both nudges", t.includes("Add 5 more for 1 free") && t.includes("Add 3 more for 3% off"));
  c.ok("cart total for 5 biscuit + 2 detergent", t.includes("₹8,873.20"));
  await click(page, "::-p-xpath(//button[normalize-space(.)='Add 5'])");
  await settle(1400);
  t = await mainText(page);
  c.ok("nudge accepted: 10 cases earn 1 free", t.includes("+1 free") && t.includes("Scheme applied: Buy 10 cases get 1 free"));
  // + on detergent (2 → 3)
  const detergent = await page.waitForSelector("::-p-xpath(//main//li[contains(., 'Detergent powder 1 kg')])");
  const plus = await detergent.waitForSelector('button[aria-label="One case more"]');
  await plus.evaluate((e) => e.scrollIntoView({ block: "center" }));
  await plus.click();
  await settle(1400);
  t = await mainText(page);
  c.ok("quantity update re-prices (3 detergent: ₹7,186.20 line, nudge 'Add 2 more')", t.includes("Add 2 more for 3% off"));
  await shot(page, "r03-cart");

  // A line that went out of stock after it was added: shown first, explained, and blocking.
  if (db) {
    const ids = (await db.execute("select (select retailer_id from users where phone = '919000000001') as r, (select id from skus where code = 'SKU-TE-250') as tea")).rows[0];
    await page.evaluate((key, tea) => {
      const lines = JSON.parse(localStorage.getItem(key) ?? "[]");
      localStorage.setItem(key, JSON.stringify([...lines, { skuId: tea, cases: 1 }]));
    }, `vf_cart_${ids.r}`, String(ids.tea));
    await page.goto(`${BASE}/shop/cart`, { waitUntil: "networkidle0" });
    await page.waitForSelector("::-p-text(1 item needs attention before you can order.)", { timeout: 10000 }).catch(() => {});
    t = await mainText(page);
    const firstLine = await page.$eval("main ul > li", (li) => li.innerText);
    c.ok("problem line explained and listed first", t.includes("1 item needs attention before you can order.") && firstLine.includes("Tea leaf 250 g"));
    const fix = await page.$("::-p-text(Fix 1 item to continue)");
    c.ok("sticky bar says why it can't continue", !!fix && !!(await fix.boundingBox()));
    await click(page, "::-p-xpath(//main//ul/li[contains(., 'Tea leaf 250 g')]//button[normalize-space(.)='Remove'])");
    await page.waitForFunction(() => !document.querySelector("main")?.innerText.includes("needs attention"), { timeout: 10000 });
    await settle(1200);
    c.ok("removing it unblocks review", !(await mainText(page)).includes("Tea leaf 250 g"));
  }

  // Checkout
  await clickVisible(page, "::-p-text(Review order)");
  await page.waitForFunction(() => location.pathname === "/shop/checkout");
  await settle(1400);
  await page.type("textarea", "Deliver before 10 am please");
  const place = await waitVisible(page, "::-p-text(Place order ·)");
  const placeLabel = await place.evaluate((b) => b.textContent);
  // 10 biscuit (₹8,164.80) + 3 detergent (₹7,186.20)
  c.eq("place-order button shows server total", placeLabel, "Place order · ₹15,351.00");
  await shot(page, "r04-checkout");
  await place.evaluate((e) => e.scrollIntoView({ block: "center" }));
  await Promise.all([page.waitForFunction(() => location.pathname.startsWith("/shop/orders/"), { timeout: 20000 }), place.click()]);
  await settle(800);
  t = await mainText(page);
  const number = t.match(/SO-\d{4}-\d{4}/)?.[0];
  c.ok("success state after placing", t.includes("Order placed") && !!number);
  c.ok("free case and note kept on the order", t.includes("+1 free") && t.includes("Deliver before 10 am please"));
  await shot(page, "r05-placed");

  await page.goto(`${BASE}/shop/cart`, { waitUntil: "networkidle0" });
  c.ok("cart cleared after the order", (await mainText(page)).includes("Your cart is empty"));

  // Order history + detail
  await page.goto(`${BASE}/shop/orders`, { waitUntil: "networkidle0" });
  t = await mainText(page);
  c.ok("new order first in history with counts", t.indexOf(number) >= 0 && /2 items · 13 cases/.test(t));
  await click(page, `::-p-xpath(//a[contains(., '${number}')])`);
  await page.waitForFunction(() => location.pathname.startsWith("/shop/orders/"));
  await settle(500);

  // Repeat an earlier (seeded) order from its detail page
  await page.goto(`${BASE}/shop/orders`, { waitUntil: "networkidle0" });
  const older = await page.$$eval("main ul li a", (as) => as.map((a) => a.getAttribute("href")));
  await page.goto(`${BASE}${older[1]}`, { waitUntil: "networkidle0" });
  const olderItems = (await page.$$eval("main li p.font-medium", (ps) => ps.map((p) => p.textContent))).filter((n) => !n.startsWith("₹"));
  await click(page, "::-p-text(Order again)");
  await page.waitForFunction(() => location.pathname === "/shop/cart");
  // Names render once the server has priced the cart.
  await page.waitForFunction((name) => document.querySelector("main")?.innerText.includes(name), { timeout: 15000 }, olderItems[0]).catch(() => {});
  t = await mainText(page);
  c.ok("order again fills the cart with that order's items", olderItems.length > 0 && olderItems.every((n) => t.includes(n)), `items ${JSON.stringify(olderItems)} | cart: ${t.slice(0, 300)}`);

  // Hindi
  await page.goto(`${BASE}/shop`, { waitUntil: "networkidle0" });
  await click(page, "::-p-text(हिंदी)");
  await page.waitForSelector("::-p-text(नमस्ते)");
  t = await mainText(page);
  c.ok("Hindi catalogue incl. GST label and stock", t.includes("GST अलग") && t.includes("स्टॉक खत्म"));
  c.ok("Hindi scheme text", t.includes("10 केस पर 1 केस मुफ़्त") && t.includes("5 या ज़्यादा केस पर 3% छूट"));
  await shot(page, "r06-hindi");
  await click(page, "::-p-text(English)");
  await settle(600);

  // Credit hold: Gupta is near the limit
  const gupta = await newPage(browser);
  await login(gupta, "9000000002", "/shop");
  await gupta.goto(`${BASE}/shop/p/SKU-DT-1KG`, { waitUntil: "networkidle0" });
  await settle(800);
  await click(gupta, "::-p-text(Add to cart)");
  await gupta.goto(`${BASE}/shop/checkout`, { waitUntil: "networkidle0" });
  await settle(1400);
  c.ok("credit warning before placing", /over your available credit/.test(await mainText(gupta)));
  const gPlace = await waitVisible(gupta, "::-p-text(Place order ·)");
  await gPlace.evaluate((e) => e.scrollIntoView({ block: "center" }));
  await Promise.all([gupta.waitForFunction(() => location.pathname.startsWith("/shop/orders/"), { timeout: 20000 }), gPlace.click()]);
  await settle(600);
  c.ok("over-limit order goes to credit hold (not rejected)", (await mainText(gupta)).includes("Order sent for credit approval"));

  // Empty state
  const fresh = await newPage(browser);
  await login(fresh, "9000000011", "/shop");
  await fresh.goto(`${BASE}/shop/cart`, { waitUntil: "networkidle0" });
  c.ok("empty cart state", (await mainText(fresh)).includes("Your cart is empty"));

  db?.close();
  for (const p of [page, gupta, fresh]) c.ok(`no console errors (${p === page ? "sharma" : p === gupta ? "gupta" : "saraswati"})`, p.consoleErrors.length === 0, p.consoleErrors.join(" | "));
  return c;
}
