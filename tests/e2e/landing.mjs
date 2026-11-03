// Public landing page at `/`: signed-out rendering at desktop and phone width, navigation,
// mobile menu, preview tabs, images, CTAs, metadata, and the redirects for signed-in users.
// Role navigation and wrong-area bounces are covered by the retailer, desk and security suites.
import { BASE, Checks, login, newPage, settle, shot } from "./lib.mjs";

const TITLE = "VyapaarFlow — Smarter Orders. Seamless Distribution.";
const SECTIONS = ["features", "how-it-works", "preview"];
const MENU = 'button[aria-controls="landing-mobile-menu"]';

/** Any same-origin request that fails (missing image, favicon…) or any console error. */
function watch(page) {
  const problems = [];
  page.on("console", (m) => m.type() === "error" && problems.push(m.text()));
  page.on("pageerror", (e) => problems.push(String(e)));
  page.on("response", (r) => r.url().startsWith(BASE) && r.status() >= 400 && problems.push(`${r.status()} ${r.url()}`));
  return problems;
}

/** Scroll the whole page so lazy images load, then report every image's load state. */
async function images(page) {
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 600) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 60));
    }
    window.scrollTo(0, 0);
  });
  return page.evaluate(async () => {
    const imgs = [...document.images];
    // Lazy images in hidden tab panels never load on their own; ask for them now, and never wait forever.
    for (const i of imgs) i.loading = "eager";
    const loaded = (i) =>
      i.complete
        ? null
        : new Promise((r) => {
            i.addEventListener("load", r, { once: true });
            i.addEventListener("error", r, { once: true });
          });
    await Promise.race([Promise.all(imgs.map(loaded)), new Promise((r) => setTimeout(r, 10000))]);
    return imgs.map((i) => ({ src: i.currentSrc || i.src, ok: i.complete && i.naturalWidth > 0 }));
  });
}

const sectionTop = (page, id) => page.evaluate((id) => Math.round(document.getElementById(id).getBoundingClientRect().top), id);

export default async function landing(browser) {
  const c = new Checks("landing");

  for (const vp of [
    { name: "desktop", width: 1280, height: 900, mobile: false },
    { name: "phone", width: 390, height: 844, mobile: true },
  ]) {
    const page = await newPage(browser, vp);
    const problems = watch(page);
    const res = await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
    const at = `[${vp.name} ${vp.width}px]`;

    c.eq(`${at} signed out / renders (200, stays on /)`, `${res.status()} ${new URL(page.url()).pathname}`, "200 /");
    c.eq(`${at} page title`, await page.title(), TITLE);
    c.ok(`${at} meta description`, (await page.$eval('meta[name="description"]', (m) => m.content).catch(() => "")).length > 50);
    c.eq(`${at} one h1 with the headline`, await page.$$eval("h1", (n) => n.map((h) => h.textContent.trim()).join("|")), "Smarter Orders. Seamless Distribution.");

    const imgs = await images(page);
    c.ok(`${at} all ${imgs.length} images load`, imgs.length >= 3 && imgs.every((i) => i.ok), JSON.stringify(imgs.filter((i) => !i.ok)));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    c.ok(`${at} no horizontal page overflow`, overflow <= 0, `${overflow}px wider than the viewport`);

    const text = await page.evaluate(() => document.body.innerText);
    c.ok(`${at} required sections and CTAs present`, ["Features", "How it works", "Product preview", "Explore Demo", "Sign In", "A person always confirms"].every((s) => text.includes(s)));
    const claims = ["voice", "photo", "offline", "testimonial", "whatsapp integration"].filter((w) => text.toLowerCase().includes(w));
    c.ok(`${at} no unbuilt capability claimed`, claims.length === 0, claims.join(", "));

    if (vp.mobile) {
      c.eq(`${at} menu starts closed`, await page.$eval(MENU, (b) => b.getAttribute("aria-expanded")), "false");
      c.ok(`${at} menu panel starts hidden`, await page.$eval("#landing-mobile-menu", (e) => e.hidden));
      await page.click(MENU);
      c.eq(`${at} menu button opens the menu`, await page.$eval(MENU, (b) => b.getAttribute("aria-expanded")), "true");
      await page.keyboard.press("Escape");
      c.ok(
        `${at} Escape closes the menu and returns focus`,
        await page.evaluate((m) => document.querySelector("#landing-mobile-menu").hidden && document.activeElement === document.querySelector(m), MENU),
      );
      for (const id of SECTIONS) {
        await page.click(MENU);
        await page.click(`#landing-mobile-menu a[href="#${id}"]`);
        await settle(400);
        const st = await page.evaluate(() => ({ hash: location.hash, closed: document.querySelector("#landing-mobile-menu").hidden }));
        const top = await sectionTop(page, id);
        c.ok(`${at} menu link #${id} scrolls there and closes the menu`, st.hash === `#${id}` && st.closed && top >= 0 && top < 120, JSON.stringify({ ...st, top }));
      }
    } else {
      for (const id of SECTIONS) {
        await page.click(`nav[aria-label="Main"] a[href="#${id}"]`);
        await settle(400);
        const top = await sectionTop(page, id);
        c.ok(`${at} nav link #${id} lands below the sticky header`, top >= 60 && top < 120, `top ${top}px`);
      }

      const tabs = await page.$$('[role="tab"]');
      c.eq(`${at} four product preview tabs`, tabs.length, 4);
      for (let i = 0; i < tabs.length; i++) {
        await tabs[i].click();
        const shown = await page.$$eval('[role="tabpanel"]', (ps) => ps.map((p) => !p.hidden));
        c.ok(`${at} tab ${i + 1} shows only its own panel`, shown.filter(Boolean).length === 1 && shown[i]);
      }
      c.ok(`${at} every tab's screenshot loads`, (await images(page)).every((i) => i.ok));
      await tabs[0].click();
      await tabs[0].focus();
      const focusedId = () => page.evaluate(() => document.activeElement.id);
      await page.keyboard.press("ArrowRight");
      c.eq(`${at} ArrowRight moves to the next tab`, await focusedId(), "tab-review");
      await page.keyboard.press("End");
      c.eq(`${at} End moves to the last tab`, await focusedId(), "tab-tally");
      await page.keyboard.press("ArrowRight");
      c.eq(`${at} ArrowRight wraps to the first tab`, await focusedId(), "tab-catalogue");

      await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
      await page.keyboard.press("Tab");
      c.eq(`${at} first Tab focuses "Skip to content"`, await page.evaluate(() => document.activeElement.textContent.trim()), "Skip to content");

      const fav = await page.evaluate(async () => {
        const link = document.querySelector('link[rel="icon"]');
        const r = await fetch("/favicon.ico");
        return { linked: Boolean(link), status: r.status, type: r.headers.get("content-type") };
      });
      c.ok(`${at} favicon linked and served`, fav.linked && fav.status === 200 && /icon/.test(fav.type ?? ""), JSON.stringify(fav));
    }

    await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
    await shot(page, `landing-${vp.name}`);
    const targets = await page.$$eval("a", (as) => as.filter((a) => /^(Explore Demo|Sign In)$/.test(a.textContent.trim())).map((a) => new URL(a.href).pathname));
    c.ok(`${at} all ${targets.length} Explore Demo / Sign In links go to /login`, targets.length >= 4 && targets.every((p) => p === "/login"), targets.join(","));
    await page.click("main a[href='/login']");
    await page.waitForFunction(() => location.pathname === "/login");
    c.ok(`${at} Explore Demo opens the existing sign-in form`, (await page.$('input[name="phone"]')) !== null && (await page.evaluate(() => document.body.innerText)).includes("Send OTP"));
    c.ok(`${at} no console errors or failed requests`, problems.length === 0, problems.join(" | "));
    await page.close();
  }

  // Signed-in users never see the landing page. Numbers not used by other suites (OTP resend limit).
  for (const [who, digits, home, vp] of [
    ["retailer", "9000000005", "/shop", undefined],
    ["desk", "9000000101", "/desk", { width: 1280, height: 900, mobile: false }],
  ]) {
    const page = await newPage(browser, vp);
    const problems = watch(page);
    await login(page, digits, home);
    for (const p of ["/", "/login"]) {
      await page.goto(`${BASE}${p}`, { waitUntil: "networkidle0" });
      c.eq(`signed-in ${who} at ${p} → ${home}`, new URL(page.url()).pathname, home);
    }
    c.ok(`signed-in ${who}: no console errors or failed requests`, problems.length === 0, problems.join(" | "));
    await page.close();
  }

  return c;
}
