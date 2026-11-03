// Order desk: dashboard → queue (filter/search/approve/release/cancel) → AI inbox → review →
// corrections → explicit confirmation → order → alias reuse → Tally CSV.
import { createClient } from "@libsql/client";
import { BASE, Checks, click, login, mainText, newPage, settle, shot } from "./lib.mjs";

// Direct DB reads verify stock; only when the runner owns the e2e database.
const db = process.env.E2E_BASE_URL ? null : createClient({ url: "file:./data/e2e.db" });
const stockOf = async (code) =>
  db ? Number((await db.execute({ sql: "select s.cases from stock s join skus k on k.id = s.sku_id where k.code = ?", args: [code] })).rows[0].cases) : null;

const createButton = "::-p-xpath(//button[starts-with(normalize-space(.), 'Create order')])";
const checkEveryLine = "::-p-xpath(//label[contains(., 'I have checked every line')]/input)";

async function openMessage(page, containing) {
  await page.goto(`${BASE}/desk/inbox`, { waitUntil: "networkidle0" });
  const card = await page.waitForSelector(`::-p-xpath(//main//li[contains(., '${containing}')])`);
  const button = await card.waitForSelector("::-p-xpath(.//button | .//a[normalize-space(.)='Review'])");
  await button.evaluate((e) => e.scrollIntoView({ block: "center" }));
  await Promise.all([page.waitForFunction(() => /^\/desk\/inbox\/[^/]+$/.test(location.pathname), { timeout: 20000 }), button.click()]);
  await settle(1800);
}

async function lineFor(page, words) {
  return page.waitForSelector(`::-p-xpath(//main//ol/li[contains(., '${words}')])`);
}

async function confirmAndCreate(page) {
  await click(page, checkEveryLine);
  await settle(300);
  const btn = await page.waitForSelector(createButton);
  const disabled = await btn.evaluate((b) => b.disabled);
  if (disabled) return { created: false, label: await btn.evaluate((b) => b.textContent) };
  await btn.evaluate((e) => e.scrollIntoView({ block: "center" }));
  await Promise.all([page.waitForFunction(() => location.pathname.startsWith("/desk/orders/"), { timeout: 20000 }), btn.click()]);
  await settle(800);
  return { created: true, number: (await mainText(page)).match(/SO-\d{4}-\d{4}/)?.[0] };
}

export default async function desk(browser) {
  const c = new Checks("desk");
  const page = await newPage(browser, { width: 1280, height: 900, mobile: false });
  await login(page, "9000000100", "/desk");
  await shot(page, "d01-dashboard");

  let t = await mainText(page);
  c.ok("dashboard tiles", ["Messages to review", "Orders to approve", "On credit hold", "Ready for Tally", "Orders today"].every((s) => t.includes(s)));
  c.ok("shops with no order in 14 days listed", t.includes("No order in 14 days") && t.includes("Saraswati Stores") && !/Sharma Kirana Store[\s\S]*days ago/.test(t.split("No order in 14 days")[1] ?? ""));

  // ── Queue: filter + search ──
  await page.goto(`${BASE}/desk/orders?filter=credit_hold`, { waitUntil: "networkidle0" });
  const holdRows = await page.$$eval("tbody tr", (rows) => rows.map((r) => r.innerText));
  c.ok("credit-hold filter shows only held orders", holdRows.length >= 1 && holdRows.every((r) => r.includes("Credit hold")));
  await page.goto(`${BASE}/desk/orders?filter=all&q=Agrawal`, { waitUntil: "networkidle0" });
  const searchRows = await page.$$eval("tbody tr", (rows) => rows.map((r) => r.innerText));
  c.ok("search by shop name", searchRows.length > 0 && searchRows.every((r) => r.includes("Agrawal Super Mart")));

  // ── Release a credit hold (reason required) ──
  await page.goto(`${BASE}/desk/orders?filter=credit_hold`, { waitUntil: "networkidle0" });
  await click(page, "tbody tr a");
  await page.waitForFunction(() => location.pathname.startsWith("/desk/orders/"));
  await settle(500);
  await click(page, "::-p-text(Approve credit and release)");
  const releaseSubmit = await page.waitForSelector("::-p-xpath(//main//form//button[@type='submit'])");
  c.ok("release needs a reason (button disabled while empty)", await releaseSubmit.evaluate((b) => b.disabled));
  await page.type("textarea", "Owner paid ₹50,000 cash today");
  await releaseSubmit.click();
  await page.waitForFunction(() => document.querySelector("main h1")?.textContent?.includes("Approved"), { timeout: 10000 }).catch(() => {});
  await settle(800);
  t = await mainText(page);
  c.ok("hold released → Approved, reason in history", t.includes("Credit approved and released") && t.includes("Owner paid ₹50,000 cash today"));

  // ── AI inbox: the brief's raw message ──
  await page.goto(`${BASE}/desk/inbox`, { waitUntil: "networkidle0" });
  await shot(page, "d02-inbox");
  await openMessage(page, "bhaiya 5 peti biscuit chhota");
  await shot(page, "d03-review");
  t = await mainText(page);
  c.ok("review shows the original message", t.includes("bhaiya 5 peti biscuit chhota, 2 peti washing powder 1 kilo, chai patti 250 wala 1 peti"));
  c.ok("rule-based fallback is labelled", t.includes("Rule-based matching only — AI not used (no API key configured)"));
  c.ok("three lines with the retailer's words", ["“5 peti biscuit chhota”", "“2 peti washing powder 1 kilo”", "“chai patti 250 wala 1 peti”"].every((w) => t.includes(w)));
  c.ok("confidence shown per line", (t.match(/(High|Medium|Low) · \d+%/g) ?? []).length === 3);
  c.ok("alternatives visible per line", (t.match(/Alternative:/g) ?? []).length === 3);
  c.ok("out-of-stock tea flagged, not accepted", t.includes("Out of stock — exclude or replace"));
  c.ok("create is disabled until a human confirms", await (await page.waitForSelector(createButton)).evaluate((b) => b.disabled));

  // "biscuit chhota" fits glucose and cream 75 g equally: the suggestion stays, but needs a decision.
  const biscuit = await lineFor(page, "5 peti biscuit chhota");
  const lineText = (el) => el.evaluate((li) => li.innerText);
  let bt = await lineText(biscuit);
  c.ok(
    "same-size sibling flagged: Medium, needs a decision, glucose still suggested",
    bt.includes("Needs a decision") && bt.includes("Another product has the same pack size") && /Medium · \d+%/.test(bt) &&
      (await biscuit.$eval("select", (s) => s.selectedOptions[0].textContent)).includes("SKU-BS-075"),
  );
  c.ok("a specific match stays ready", (await lineText(await lineFor(page, "2 peti washing powder 1 kilo"))).includes("Ready"));
  await click(biscuit, "::-p-text(Keep this product)");
  await settle(300);
  bt = await lineText(biscuit);
  c.ok("keeping the suggested product settles the line", bt.includes("Ready") && !bt.includes("Keep this product"));

  // Desk correction: this shop's "biscuit chhota" is the cream biscuit; exclude the tea.
  await biscuit.$eval("select", (s) => {
    const opt = [...s.options].find((o) => o.textContent.includes("SKU-BC-075"));
    s.value = opt.value;
    s.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const tea = await lineFor(page, "chai patti 250 wala");
  const teaInclude = await tea.waitForSelector("::-p-xpath(.//label[contains(., 'Include in order')]/input)");
  await teaInclude.evaluate((e) => e.scrollIntoView({ block: "center" }));
  await teaInclude.click();
  await settle(1500);
  t = await mainText(page);
  c.ok("correction will be saved for this shop", t.includes("Corrected — will be saved for this shop when you create the order"));
  const creamBefore = await stockOf("SKU-BC-075");
  const first = await confirmAndCreate(page);
  c.ok("order created only after explicit confirmation", first.created && !!first.number, JSON.stringify(first));
  t = await mainText(page);
  c.ok("order page: created banner + capture in history", t.includes("created from the message") && t.includes("Created from AI capture (desk confirmed)"));
  c.ok("order page confirms the shop word the server saved", t.includes("Saved as this shop's words: 1."));
  if (db) c.eq("cream biscuit stock reserved (5 cases)", await stockOf("SKU-BC-075"), creamBefore - 5);
  await shot(page, "d04-order-created");

  // Approve it
  await click(page, "::-p-xpath(//button[normalize-space(.)='Approve'])");
  await settle(1200);
  c.ok("approve → Approved", (await mainText(page)).includes("Cancel order"));
  const firstOrderUrl = page.url();

  // ── Alias reuse: the same words from the same shop now match the corrected SKU ──
  await page.goto(`${BASE}/desk/inbox`, { waitUntil: "networkidle0" });
  await page.select('select[name="retailerId"]', await page.$eval('select[name="retailerId"]', (s) => [...s.options].find((o) => o.textContent.includes("Sharma Kirana Store")).value));
  await page.type('textarea[name="body"]', "3 peti biscuit chhota");
  await click(page, "::-p-text(Add and review)");
  await page.waitForFunction(() => /^\/desk\/inbox\/[^/]+$/.test(location.pathname), { timeout: 20000 });
  await settle(1800);
  t = await mainText(page);
  c.ok("pasted message is read for that shop", t.includes("“3 peti biscuit chhota”"));
  c.ok("saved alias used (shop's saved word → cream biscuit)", t.includes("shop's saved word") && (await (await lineFor(page, "3 peti biscuit chhota")).$eval("select", (s) => s.selectedOptions[0].textContent)).includes("SKU-BC-075"));
  c.ok("a saved alias is not flagged as a same-size sibling", !(await (await lineFor(page, "3 peti biscuit chhota")).evaluate((li) => li.innerText)).includes("Another product has the same pack size"));
  await shot(page, "d05-alias");

  // ── Instruction text and a separated quantity: shown word for word, never joined, never ordered as-is ──
  await page.goto(`${BASE}/desk/inbox`, { waitUntil: "networkidle0" });
  await page.select('select[name="retailerId"]', await page.$eval('select[name="retailerId"]', (s) => [...s.options].find((o) => o.textContent.includes("Sharma Kirana Store")).value));
  await page.type('textarea[name="body"]', "give 50% discount. glucose biscuit 75g, 5 peti");
  await click(page, "::-p-text(Add and review)");
  await page.waitForFunction(() => /^\/desk\/inbox\/[^/]+$/.test(location.pathname), { timeout: 20000 });
  await settle(1800);
  t = await mainText(page);
  c.ok("instruction kept as its own line and labelled", t.includes("“give 50% discount”") && t.includes("Looks like an instruction, not an item"));
  c.ok("separated quantity flagged on both lines, not joined", t.includes("“glucose biscuit 75g”") && t.includes("“5 peti”") && (t.match(/The quantity may be written in another part of the message/g) ?? []).length === 2);
  const qtyOf = async (li) => li.$eval('input[inputmode="numeric"]', (i) => i.value);
  const biscuitLine = await lineFor(page, "“glucose biscuit 75g”");
  c.eq("biscuit quantity left empty for the desk", await qtyOf(biscuitLine), "");
  await click(page, checkEveryLine);
  await settle(300);
  c.ok("cannot create while instruction and quantity are unresolved", await (await page.waitForSelector(createButton)).evaluate((b) => b.disabled));
  {
    // Choosing a product for the instruction line is allowed, but it is never promised as a shop word.
    const instr = await lineFor(page, "“give 50% discount”");
    await instr.$eval("select", (s) => {
      s.value = [...s.options].find((o) => o.textContent.includes("SKU-RK-200")).value;
      s.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle(400);
    const it = await instr.evaluate((li) => li.innerText);
    c.ok("instruction line correction is for this order only", it.includes("Corrected for this order only") && !it.includes("will be saved for this shop"));
  }
  for (const words of ["“give 50% discount”", "“5 peti”"]) {
    const include = await (await lineFor(page, words)).waitForSelector("::-p-xpath(.//label[contains(., 'Include in order')]/input)");
    await include.evaluate((e) => e.scrollIntoView({ block: "center" }));
    await include.click();
    await settle(200);
  }
  await biscuitLine.$eval('input[inputmode="numeric"]', (i) => i.scrollIntoView({ block: "center" }));
  await (await biscuitLine.$('input[inputmode="numeric"]')).type("5");
  await (await biscuitLine.waitForSelector("::-p-xpath(.//button[@role='radio'][normalize-space(.)='Cases'])")).click();
  await settle(1500);
  await click(page, checkEveryLine);
  await settle(300);
  c.ok("after the desk excludes the instruction and enters the quantity, create is enabled", !(await (await page.waitForSelector(createButton)).evaluate((b) => b.disabled)));
  await shot(page, "d05b-instruction");

  // ── Requested terms on a product line: warned, priced normally, confirmable after the desk notes it ──
  await page.goto(`${BASE}/desk/inbox`, { waitUntil: "networkidle0" });
  await page.select('select[name="retailerId"]', await page.$eval('select[name="retailerId"]', (s) => [...s.options].find((o) => o.textContent.includes("Sharma Kirana Store")).value));
  await page.type('textarea[name="body"]', "5 peti glucose biscuit 75g 50% off");
  await click(page, "::-p-text(Add and review)");
  await page.waitForFunction(() => /^\/desk\/inbox\/[^/]+$/.test(location.pathname), { timeout: 20000 });
  await settle(1800);
  const termsLine = await lineFor(page, "“5 peti glucose biscuit 75g 50% off”");
  let tl = await termsLine.evaluate((li) => li.innerText);
  c.ok("requested terms warned, line needs a decision", tl.includes("The retailer asked for a discount, free goods or a price") && tl.includes("Needs a decision"));
  c.ok("requested terms line is priced at the normal case price", /₹[\d,]+\.\d\d \/ case excl\. GST/.test(tl));
  await click(termsLine, "::-p-text(Noted: use normal pricing)");
  await settle(300);
  tl = await termsLine.evaluate((li) => li.innerText);
  c.ok("noting the terms settles the line", tl.includes("Ready") && !tl.includes("Noted: use normal pricing"));
  await click(page, checkEveryLine);
  await settle(300);
  c.ok("order can be created at normal pricing after the warning", !(await (await page.waitForSelector(createButton)).evaluate((b) => b.disabled)));

  // ── Hindi message: unit not written → must be settled to cases before an order can exist ──
  await openMessage(page, "भैया 10 पेटी");
  t = await mainText(page);
  c.ok("unclear unit is asked, not guessed", t.includes("Unit not written. Ask the retailer: cases or pieces?") && t.includes("Needs a decision"));
  await click(page, checkEveryLine);
  await settle(300);
  c.ok("cannot create while a unit is unknown", await (await page.waitForSelector(createButton)).evaluate((b) => b.disabled));
  const unclear = await page.waitForSelector("::-p-xpath(//main//ol/li[contains(., 'Unit not written')])");
  const pieces = await unclear.waitForSelector("::-p-xpath(.//button[@role='radio'][normalize-space(.)='Pieces'])");
  await pieces.evaluate((e) => e.scrollIntoView({ block: "center" }));
  await pieces.click();
  await settle(400);
  c.ok("pieces are not accepted as an order unit", (await mainText(page)).includes("Orders are in cases"));
  const cases = await unclear.waitForSelector("::-p-xpath(.//button[@role='radio'][normalize-space(.)='Cases'])");
  await cases.click();
  await settle(1400);
  const second = await confirmAndCreate(page);
  c.ok("after settling the unit, the order is created", second.created, JSON.stringify(second));

  // ── Cancel restores stock ──
  const bhujiaBefore = await stockOf("SKU-NM-400");
  await click(page, "::-p-xpath(//button[normalize-space(.)='Cancel order'])");
  await page.type("textarea", "Retailer cancelled on the phone");
  await click(page, "::-p-xpath(//main//form//button[@type='submit'])");
  await settle(1400);
  t = await mainText(page);
  c.ok("cancelled with reason", t.includes("Retailer cancelled on the phone") && t.includes("No further actions"));
  if (db) c.eq("cancel returns reserved bhujia stock (3 cases)", await stockOf("SKU-NM-400"), bhujiaBefore + 3);

  // ── Tally export ──
  await page.goto(`${BASE}/desk/export`, { waitUntil: "networkidle0" });
  t = await mainText(page);
  c.ok("approved desk order is ready for Tally", !!first.number && t.includes(first.number));
  await shot(page, "d06-export");
  await click(page, "::-p-xpath(//button[starts-with(normalize-space(.), 'Export CSV')])");
  await page.waitForSelector("::-p-text(orders exported)", { timeout: 15000 });
  await settle(800);
  const href = await page.$eval("main a[href^='/desk/export/']", (a) => a.getAttribute("href"));
  const csv = await page.evaluate(async (h) => {
    const r = await fetch(h);
    const bytes = new Uint8Array(await r.arrayBuffer());
    return { status: r.status, type: r.headers.get("content-type"), bom: bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf, text: new TextDecoder().decode(bytes) };
  }, href);
  const rows = csv.text.replace(/^﻿/, "").trimEnd().split("\r\n");
  c.ok("CSV download is a UTF-8 CSV with BOM", csv.status === 200 && csv.type.startsWith("text/csv") && csv.bom);
  c.ok("CSV header is the Tally layout", rows[0].startsWith("Voucher Date,Voucher Type,Voucher Number,Party Code,Party Ledger"));
  const ours = rows.filter((r) => r.includes(first.number));
  c.ok("CSV rows for the captured order (cream biscuit + detergent, totals)", ours.length === 2 && ours.some((r) => r.includes("SKU-BC-075")) && ours.every((r) => r.includes(",capture,")));
  await page.goto(`${BASE}/desk/export`, { waitUntil: "networkidle0" });
  c.ok("exported orders leave the export list", !(await mainText(page)).split("Past exports")[0].includes(first.number));
  await page.goto(firstOrderUrl, { waitUntil: "networkidle0" });
  c.ok("exported order is final (no actions)", (await mainText(page)).includes("No further actions"));

  c.ok("no console errors (desk)", page.consoleErrors.length === 0, page.consoleErrors.join(" | "));
  db?.close();
  return c;
}
