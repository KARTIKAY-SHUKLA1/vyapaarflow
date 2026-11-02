// Shared helpers for the browser smoke tests (puppeteer-core + a locally installed Chrome/Edge).
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

export const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const SHOTS = process.env.E2E_SCREENSHOTS; // optional directory for screenshots

const CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

export function findBrowser() {
  const found = CANDIDATES.find((p) => existsSync(p));
  if (!found) throw new Error("No Chrome/Edge found. Set CHROME_PATH to a Chromium-based browser.");
  return found;
}

/** Collects named checks; a suite fails if any check fails (non-zero exit in run.mjs). */
export class Checks {
  constructor(suite) {
    this.suite = suite;
    this.results = [];
  }
  ok(name, condition, detail = "") {
    this.results.push({ name, pass: !!condition, detail });
    console.log(`  ${condition ? "✓" : "✗"} ${name}${!condition && detail ? ` — ${detail}` : ""}`);
  }
  eq(name, actual, expected) {
    this.ok(name, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
  get failed() {
    return this.results.filter((r) => !r.pass);
  }
}

export async function launch() {
  return puppeteer.launch({ executablePath: findBrowser(), headless: true, args: ["--no-sandbox"] });
}

/** A fresh, isolated browser context (own cookies + localStorage) with console-error capture. */
export async function newPage(browser, { width = 390, height = 844, mobile = true } = {}) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
  page.consoleErrors = [];
  page.on("console", (m) => {
    // Expected 404s from the security checks are not app errors.
    if (m.type() === "error" && !/status of 404/.test(m.text())) page.consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => page.consoleErrors.push(String(e)));
  return page;
}

export const settle = (ms = 900) => new Promise((r) => setTimeout(r, ms));
export const mainText = (page) => page.evaluate(() => (document.querySelector("main") ?? document.body).innerText);

/** Scroll into the middle of the viewport first, so fixed bars (bottom nav) never intercept the click. */
export async function click(page, selector, { timeout = 10000 } = {}) {
  const el = await page.waitForSelector(selector, { timeout, visible: true });
  await el.evaluate((e) => e.scrollIntoView({ block: "center" }));
  await el.click();
  return el;
}

/** Click the first *visible* element matching a selector (desktop + phone variants of a button). */
export async function clickVisible(page, selector) {
  for (const el of await page.$$(selector)) {
    if (await el.boundingBox()) {
      await el.evaluate((e) => e.scrollIntoView({ block: "center" }));
      await el.click();
      return el;
    }
  }
  throw new Error(`No visible element for ${selector}`);
}

export async function typeInto(page, selector, value) {
  const el = await page.waitForSelector(selector, { visible: true });
  await el.evaluate((e) => e.scrollIntoView({ block: "center" }));
  await el.click({ clickCount: 3 });
  await el.type(String(value));
  return el;
}

/** Sign in with the demo OTP shown on screen (DEMO_MODE=true). */
export async function login(page, digits, landing) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle0" });
  await page.type('input[name="phone"]', digits);
  await click(page, "::-p-text(Send OTP)");
  const otp = (await (await page.waitForSelector(".font-mono")).evaluate((e) => e.textContent)).trim();
  await page.type('input[name="code"]', otp);
  await click(page, "::-p-text(Verify and continue)");
  await page.waitForFunction((p) => location.pathname === p, { timeout: 15000 }, landing);
  await settle(500);
}

export async function shot(page, name) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
}
