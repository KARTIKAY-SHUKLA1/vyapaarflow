/**
 * AI capture evaluation harness (Stage 3). NOT part of `npm test`.
 *
 *   npx tsx eval/capture/run.ts --engine rules      # deterministic rules engine, all cases
 *   npx tsx eval/capture/run.ts --engine fallback   # mocked model failures + confirmation rules
 *   npx tsx --env-file=.env.local eval/capture/run.ts --engine gemini --key-rotated   # live Gemini (opt-in)
 *
 * Every run uses a fresh, migrated and seeded temporary SQLite file (src/test/db.ts).
 * It never connects to Turso: DATABASE_URL is forced to :memory: before any app module
 * loads, and the auth token is cleared. API keys are never printed or written.
 *
 * Messages go through the real server path: addManualMessage → runCapture → getReview →
 * priceForDesk (stock) → confirmCapture (confirmation rules). Expectations live in
 * dataset.json and were written before the first run.
 */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// ── Isolation guard: must run before any app module is imported ──
process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";
process.env.ALLOW_REMOTE_WIPE = "";
(process.env as Record<string, string>).NODE_ENV = "development"; // never "production" here
process.env.SESSION_SECRET ||= "eval-only-local-secret-eval-only-local-secret";

const HERE = path.join(process.cwd(), "eval", "capture");
const arg = (name: string) => process.argv.includes(name);
const engineArg = process.argv[process.argv.indexOf("--engine") + 1] ?? "rules";
if (!["rules", "fallback", "gemini"].includes(engineArg)) throw new Error("--engine rules|fallback|gemini");

type Unit = "case" | "piece" | "unknown";
type ExpectedLine = {
  sku?: string | null;
  anyOf?: string[];
  historyPreferred?: string[];
  qty: number | null;
  unit: Unit;
  mustFlag?: boolean;
  matchedBy?: string;
  notMatchedBy?: string;
  stock?: "OUT_OF_STOCK" | "EXCEEDS_STOCK";
};
type Case = {
  id: string;
  category: string;
  language: string;
  retailer: string | null;
  message: string;
  expect: {
    lines: ExpectedLine[];
    confirm?: string;
    fallbackReason?: string;
    extraLinesMustAbstain?: boolean;
    noExtraDiscount?: boolean;
    priceUnchanged?: boolean;
    forbiddenSkus?: string[];
  };
};

async function main() {
  const datasetText = readFileSync(path.join(HERE, "dataset.json"), "utf8");
  const dataset = JSON.parse(datasetText) as { setup: { alias: { retailer: string; message: string; correctTo: string } }; cases: Case[] };
  const datasetSha256 = createHash("sha256").update(datasetText).digest("hex");

  const { eq, and, inArray, sql } = await import("drizzle-orm");
  const { testDb } = await import("@/test/db");
  const schema = await import("@/db/schema");
  const cap = await import("@/server/capture");
  const { isoDateIST } = await import("@/lib/pricing");
  const { CircuitBreaker } = await import("@/lib/capture");
  const llm = await import("@/lib/capture/llm");
  const { createCaptureModel } = await import("@/lib/capture/providers");
  type CaptureModel = import("@/lib/capture/llm").CaptureModel;

  const { db, skuIds, staffIds } = await testDb(new Date());
  const asOf = isoDateIST(new Date());
  const codeOf = new Map([...skuIds].map(([code, id]) => [id, code]));
  const retailerRows = await db.select({ id: schema.retailers.id, code: schema.retailers.code }).from(schema.retailers);
  const retailerId = (code: string) => retailerRows.find((r) => r.code === code)!.id;
  const viewer = { id: staffIds.get("D1")!, name: "Neha Soni", role: "desk" as const, retailerId: null, language: "en" as const };

  /** CaptureLine.confidenceBand / needsReview, as defined in src/lib/capture/types.ts. */
  const band = (c: number) => (c >= 80 ? "high" : c >= 50 ? "medium" : "low");
  const needsReview = (l: { issues: string[]; confidence: number; unit: string }) =>
    l.issues.length > 0 || band(l.confidence) !== "high" || l.unit === "piece";

  async function intake(c: { retailer: string | null; message: string }) {
    if (c.retailer) {
      const res = await cap.addManualMessage(db, viewer, { retailerId: retailerId(c.retailer), body: c.message });
      if (res.ok) return { messageId: res.messageId, intake: "accepted" };
    }
    // Unknown sender, or a body the paste form rejects (e.g. empty): store it as an inbound
    // message the way the WhatsApp intake would, so capture behaviour can still be measured.
    const [m] = await db
      .insert(schema.inboundMessages)
      .values({ retailerId: c.retailer ? retailerId(c.retailer) : null, fromPhone: "919888800000", channel: "whatsapp", body: c.message, receivedAt: new Date() })
      .returning({ id: schema.inboundMessages.id });
    return { messageId: m.id, intake: c.retailer ? "rejected by paste form; stored as inbound" : "unknown sender (inbound)" };
  }

  async function capture(c: { retailer: string | null; message: string }, model: CaptureModel | null, opts: { breaker?: InstanceType<typeof CircuitBreaker> } = {}) {
    const { messageId, intake: how } = await intake(c);
    const t0 = performance.now();
    const run = await cap.runCapture(db, viewer, messageId, { model, breaker: opts.breaker ?? new CircuitBreaker(), force: true });
    const ms = Math.round(performance.now() - t0);
    const review = (await cap.getReview(db, viewer, messageId))!;
    return { messageId, intake: how, run, ms, review };
  }

  async function stockIssues(retailerCode: string, skuId: string, cases: number) {
    const p = await cap.priceForDesk(db, viewer, retailerId(retailerCode), [{ skuId, cases }], asOf);
    return { issues: p?.lines[0]?.issues ?? [], pricing: p };
  }

  // ── Setup: a desk correction creates an alias through the real confirm path ──
  async function setupAlias() {
    const s = dataset.setup.alias;
    const { review } = await capture({ retailer: s.retailer, message: s.message }, null);
    const target = skuIds.get(s.correctTo)!;
    const line = review.lines[0];
    const priced = await cap.priceForDesk(db, viewer, retailerId(s.retailer), [{ skuId: target, cases: line.quantity ?? 1 }], asOf);
    const res = await cap.confirmCapture(db, viewer, {
      captureId: review.capture!.id,
      lines: [{ lineId: line.id, include: true, skuId: target, quantity: line.quantity ?? 1, unit: "case" }],
      expectedTotalPaise: priced!.totals.totalPaise,
      idempotencyKey: randomUUID(),
      confirmed: true,
    });
    const aliases = await db.select().from(schema.retailerAliases).where(eq(schema.retailerAliases.retailerId, retailerId(s.retailer)));
    return { confirmed: res.ok, aliasesSaved: aliases.map((a) => ({ phrase: a.phrase, sku: codeOf.get(a.skuId) })) };
  }

  async function historyTop(retailerCode: string, codes: string[]) {
    const rows = await db
      .select({ skuId: schema.orderLines.skuId, n: sql<number>`count(*)`.mapWith(Number) })
      .from(schema.orderLines)
      .innerJoin(schema.orders, eq(schema.orders.id, schema.orderLines.orderId))
      .where(and(eq(schema.orders.retailerId, retailerId(retailerCode)), inArray(schema.orderLines.skuId, codes.map((c) => skuIds.get(c)!))))
      .groupBy(schema.orderLines.skuId);
    const counts = Object.fromEntries(codes.map((c) => [c, rows.find((r) => codeOf.get(r.skuId) === c)?.n ?? 0]));
    const max = Math.max(...Object.values(counts));
    const top = Object.entries(counts).filter(([, n]) => n === max && n > 0).map(([c]) => c);
    return { counts, preferred: top.length === 1 ? top[0] : null };
  }

  // ── Scoring one case ──
  async function score(c: Case, out: Awaited<ReturnType<typeof capture>>, extra: { historyPreferred?: string | null } = {}) {
    const lines = out.review.lines.map((l) => ({
      id: l.id,
      text: l.originalText,
      sku: l.skuId ? codeOf.get(l.skuId)! : null,
      alternatives: [l.alt1SkuId, l.alt2SkuId].filter(Boolean).map((id) => codeOf.get(id!)!),
      qty: l.quantity,
      unit: l.unit as Unit,
      confidence: l.confidence,
      band: band(l.confidence),
      matchedBy: l.matchedBy,
      issues: (l.issues ?? []) as string[],
      flagged: needsReview({ issues: (l.issues ?? []) as string[], confidence: l.confidence, unit: l.unit }),
    }));
    const checks: { name: string; pass: boolean; detail?: string }[] = [];
    const lineResults: Record<string, unknown>[] = [];

    // Alignment. Default: by position. When a case allows extra lines that must abstain
    // (injection text becomes its own segment), expected items are matched in order to the
    // lines that proposed a product; every other line must then abstain. If those counts
    // differ, positional alignment is used (and the case fails on its own merits).
    let aligned = lines;
    let extraLines = lines.slice(c.expect.lines.length);
    const proposing = lines.filter((l) => l.sku !== null);
    if (c.expect.extraLinesMustAbstain && lines.length > c.expect.lines.length && proposing.length === c.expect.lines.length) {
      aligned = proposing;
      extraLines = lines.filter((l) => l.sku === null);
    }

    for (let i = 0; i < c.expect.lines.length; i++) {
      const e = c.expect.lines[i];
      const a = aligned[i];
      const r: Record<string, unknown> = { expected: e, actual: a ?? null };
      if (!a) {
        r.sku = "missing-line";
        checks.push({ name: `line ${i + 1} present`, pass: false });
        lineResults.push(r);
        continue;
      }
      const exactExpected = e.historyPreferred ? (extra.historyPreferred ?? undefined) : e.sku;
      if (e.historyPreferred && !extra.historyPreferred) {
        e.anyOf = e.historyPreferred; // no single most-ordered SKU in history: treat as ambiguous
        e.mustFlag = true;
      }
      if (e.anyOf) {
        const offered = new Set([a.sku, ...a.alternatives].filter(Boolean));
        const need = Math.min(e.anyOf.length, 3);
        const covered = e.anyOf.filter((s) => offered.has(s)).length;
        r.sku = !a.sku || !e.anyOf.includes(a.sku) ? "wrong" : !a.flagged ? "ambiguous-silently-picked" : covered >= need ? "ambiguity-flagged" : "ambiguity-flagged-alternatives-incomplete";
        r.alternativesCovered = `${covered}/${need}`;
        checks.push({ name: `line ${i + 1} ambiguity flagged with options`, pass: r.sku === "ambiguity-flagged", detail: String(r.sku) });
      } else if (exactExpected === null) {
        r.sku = a.sku === null ? "safe-abstention" : a.flagged ? "flagged-guess" : "unsafe-match";
        checks.push({ name: `line ${i + 1} abstains`, pass: a.sku === null, detail: `${r.sku} (${a.sku})` });
      } else {
        r.sku = a.sku === exactExpected ? "correct" : a.sku === null ? "abstained-missed" : a.flagged ? "wrong-flagged" : "wrong-unflagged";
        checks.push({ name: `line ${i + 1} sku ${exactExpected}`, pass: a.sku === exactExpected, detail: `${a.sku}` });
      }
      r.qty = a.qty === e.qty ? "correct" : "wrong";
      checks.push({ name: `line ${i + 1} qty ${e.qty}`, pass: a.qty === e.qty, detail: String(a.qty) });
      r.unit = a.unit === e.unit ? "correct" : e.unit === "unknown" ? "guessed" : "wrong";
      checks.push({ name: `line ${i + 1} unit ${e.unit}`, pass: a.unit === e.unit, detail: a.unit });
      if (e.mustFlag) checks.push({ name: `line ${i + 1} flagged for review`, pass: a.flagged, detail: `${a.band} ${a.issues.join(",")}` });
      if (e.matchedBy) checks.push({ name: `line ${i + 1} matchedBy ${e.matchedBy}`, pass: a.matchedBy === e.matchedBy, detail: a.matchedBy });
      if (e.notMatchedBy) checks.push({ name: `line ${i + 1} not matchedBy ${e.notMatchedBy}`, pass: a.matchedBy !== e.notMatchedBy, detail: a.matchedBy });
      if (e.stock) {
        const skuForStock = a.sku ?? exactExpected ?? null;
        const s = skuForStock ? await stockIssues(c.retailer!, skuIds.get(skuForStock)!, a.qty ?? e.qty ?? 1) : { issues: [] as string[] };
        r.stock = s.issues.includes(e.stock) ? "flagged" : "missed";
        checks.push({ name: `line ${i + 1} stock ${e.stock}`, pass: s.issues.includes(e.stock), detail: s.issues.join(",") || "none" });
      }
      lineResults.push(r);
    }

    if (c.expect.lines.length === 0 || !c.expect.extraLinesMustAbstain) {
      checks.push({ name: `line count ${c.expect.lines.length}`, pass: lines.length === c.expect.lines.length, detail: String(lines.length) });
    } else {
      checks.push({ name: "extra lines abstain", pass: extraLines.every((l) => l.sku === null), detail: extraLines.map((l) => `${l.text}→${l.sku}`).join(" | ") || "none" });
    }
    if (c.expect.forbiddenSkus) {
      const used = lines.flatMap((l) => [l.sku, ...l.alternatives]).filter((s) => c.expect.forbiddenSkus!.includes(s!));
      checks.push({ name: "forbidden SKUs never proposed", pass: used.length === 0, detail: used.join(",") || "none" });
    }
    if (c.expect.fallbackReason) {
      checks.push({ name: `fallbackReason ${c.expect.fallbackReason}`, pass: out.review.capture?.fallbackReason === c.expect.fallbackReason, detail: String(out.review.capture?.fallbackReason) });
    }
    if (c.expect.priceUnchanged || c.expect.noExtraDiscount) {
      const e = c.expect.lines[0];
      const a = aligned[0];
      if (a?.sku && a.qty) {
        const live = (await stockIssues(c.retailer!, skuIds.get(a.sku)!, a.qty)).pricing!;
        const [priceRow] = await db.select({ p: schema.prices.pricePerPiecePaise }).from(schema.prices).where(and(eq(schema.prices.skuId, skuIds.get(e.sku!)!), eq(schema.prices.priceTier, "standard")));
        if (c.expect.priceUnchanged) checks.push({ name: "price is the catalogue price", pass: live.lines[0].item.pricePerPiecePaise === priceRow.p, detail: `${live.lines[0].item.pricePerPiecePaise} vs ${priceRow.p}` });
        if (c.expect.noExtraDiscount) {
          const control = (await stockIssues(c.retailer!, skuIds.get(e.sku!)!, e.qty!)).pricing!;
          checks.push({ name: "discount is scheme-only (same as a clean order)", pass: live.totals.discountPaise === control.totals.discountPaise, detail: `${live.totals.discountPaise} vs ${control.totals.discountPaise}` });
        }
      }
    }
    if (c.expect.confirm) {
      const res = await cap.confirmCapture(db, viewer, {
        captureId: out.review.capture!.id,
        lines: out.review.lines.map((l) => ({ lineId: l.id, include: true, skuId: l.skuId, quantity: l.quantity, unit: "case" })),
        expectedTotalPaise: 0,
        idempotencyKey: randomUUID(),
        confirmed: true,
      });
      checks.push({ name: `confirm → ${c.expect.confirm}`, pass: !res.ok && res.error === c.expect.confirm, detail: res.ok ? "order created" : res.error });
    }

    return {
      id: c.id,
      category: c.category,
      language: c.language,
      message: c.message,
      intake: out.intake,
      engine: out.review.capture?.engine,
      model: out.review.capture?.model,
      fallbackReason: out.review.capture?.fallbackReason,
      ms: out.ms,
      lines,
      lineResults,
      checks,
      pass: checks.every((k) => k.pass),
    };
  }

  // ── Case runs (rules or gemini) ──
  async function runCases(model: CaptureModel | null, label: string) {
    const setup = await setupAlias();
    const hist = await historyTop("RT-1009", ["SKU-NM-150", "SKU-NM-400"]);
    const results = [];
    for (const c of structuredClone(dataset.cases) as Case[]) {
      const out = await capture(c, model);
      results.push(await score(c, out, { historyPreferred: c.expect.lines[0]?.historyPreferred ? hist.preferred : undefined }));
    }
    return { label, setup, history: { retailer: "RT-1009", ...hist }, results };
  }

  function summarise(results: Awaited<ReturnType<typeof score>>[]) {
    const lr = results.flatMap((r) => r.lineResults);
    const count = (k: string, v: string) => lr.filter((x) => x[k] === v).length;
    const flaggedLines = results.flatMap((r) => r.lines);
    const correctness = results.flatMap((r) => r.lineResults.map((x) => ({ band: (x.actual as { band?: string } | null)?.band, ok: x.sku === "correct" || x.sku === "safe-abstention" || x.sku === "ambiguity-flagged" })));
    const byBand = Object.fromEntries(["high", "medium", "low"].map((b) => [b, { lines: correctness.filter((x) => x.band === b).length, acceptable: correctness.filter((x) => x.band === b && x.ok).length }]));
    const ms = results.map((r) => r.ms).sort((a, b) => a - b);
    return {
      cases: results.length,
      casesPassed: results.filter((r) => r.pass).length,
      expectedLines: lr.length,
      actualLines: flaggedLines.length,
      sku: {
        correct: count("sku", "correct"),
        wrongFlagged: count("sku", "wrong-flagged"),
        wrongUnflagged: count("sku", "wrong-unflagged"),
        abstainedMissed: count("sku", "abstained-missed"),
        safeAbstention: count("sku", "safe-abstention"),
        flaggedGuess: count("sku", "flagged-guess"),
        unsafeMatch: count("sku", "unsafe-match"),
        ambiguityFlagged: count("sku", "ambiguity-flagged"),
        ambiguityFlaggedAltsIncomplete: count("sku", "ambiguity-flagged-alternatives-incomplete"),
        ambiguousSilentlyPicked: count("sku", "ambiguous-silently-picked"),
        ambiguousWrong: lr.filter((x) => x.sku === "wrong" ).length,
        missingLine: count("sku", "missing-line"),
      },
      quantity: { correct: count("qty", "correct"), wrong: count("qty", "wrong") },
      unit: { correct: count("unit", "correct"), wrong: count("unit", "wrong"), guessed: count("unit", "guessed") },
      stock: { flagged: count("stock", "flagged"), missed: count("stock", "missed") },
      confidenceBandVsOutcome: byBand,
      fallbacks: results.filter((r) => r.engine === "rules" && r.fallbackReason && !["no_api_key", "empty_message", "no_items_found"].includes(r.fallbackReason)).map((r) => `${r.id}:${r.fallbackReason}`),
      latencyMs: { median: ms[Math.floor(ms.length / 2)], p90: ms[Math.floor(ms.length * 0.9)], max: ms[ms.length - 1] },
    };
  }

  // ── Mocked model failures and confirmation rules (fallback suite) ──
  async function fallbackSuite() {
    const out: { id: string; name: string; pass: boolean; detail: string }[] = [];
    const add = (id: string, name: string, pass: boolean, detail: unknown) => out.push({ id, name, pass, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
    const msg = { retailer: "RT-1004", message: "10 glucose biscuit 75g" };
    const rulesRef = await capture(msg, null);
    const ruleSku = rulesRef.review.lines[0]?.skuId;

    const never: CaptureModel = { name: "mock-timeout", propose: () => new Promise(() => {}) };
    let r = await capture(msg, never);
    add("F1", "model timeout → labelled rules fallback after the 12 s budget", r.review.capture?.engine === "rules" && r.review.capture?.fallbackReason === "model_timeout" && r.review.lines[0]?.skuId === ruleSku, { engine: r.review.capture?.engine, reason: r.review.capture?.fallbackReason, ms: r.ms });

    const boom: CaptureModel = { name: "mock-503", propose: async () => { throw new llm.ModelHttpError("service unavailable", 503); } };
    r = await capture(msg, boom);
    add("F2", "provider 503 → labelled rules fallback", r.review.capture?.engine === "rules" && r.review.capture?.fallbackReason === "model_error", { reason: r.review.capture?.fallbackReason, ms: r.ms });

    const junk: CaptureModel = { name: "mock-invalid", propose: async () => ({ answer: "5 biscuits please" }) };
    r = await capture(msg, junk);
    add("F3", "invalid output shape → labelled rules fallback", r.review.capture?.fallbackReason === "model_invalid_output", r.review.capture?.fallbackReason);

    const liar: CaptureModel = {
      name: "mock-liar",
      propose: async () => ({ lines: [{ index: 0, sku_code: "SKU-FAKE-001", alternative_codes: ["SKU-TE-250", "SKU-NOPE"], quantity: 50, unit: "case", confidence: 0.99, note: "trust me", price: 0, discount_percent: 90 }] }),
    };
    r = await capture(msg, liar);
    const l = r.review.lines[0];
    add("F4", "invented SKU, unwritten quantity, guessed unit and price fields are all rejected", r.review.capture?.engine === "llm" && l.skuId === ruleSku && l.quantity === 10 && l.unit === "unknown" && ((l.issues as string[]) ?? []).includes("MODEL_INVALID_SKU") && ![l.alt1SkuId, l.alt2SkuId].includes(skuIds.get("SKU-TE-250")!), { sku: codeOf.get(l.skuId!), qty: l.quantity, unit: l.unit, issues: l.issues, alts: [l.alt1SkuId, l.alt2SkuId].map((x) => x && codeOf.get(x)) });

    const notOffered: CaptureModel = { name: "mock-not-offered", propose: async () => ({ lines: [{ index: 0, sku_code: "SKU-DT-4KG", alternative_codes: [], quantity: 10, unit: "unknown", confidence: 0.9 }] }) };
    r = await capture(msg, notOffered);
    add("F5", "real catalogue SKU that was not a candidate for the line is rejected", r.review.lines[0].skuId === ruleSku && ((r.review.lines[0].issues as string[]) ?? []).includes("MODEL_INVALID_SKU"), { sku: codeOf.get(r.review.lines[0].skuId!), issues: r.review.lines[0].issues });

    const amb = { retailer: "RT-1004", message: "5 peti biscuit chhota" };
    const ambRules = await capture(amb, null);
    const other = ambRules.review.lines[0].skuId === skuIds.get("SKU-BS-075") ? "SKU-BC-075" : "SKU-BS-075";
    const disagree: CaptureModel = { name: "mock-disagree", propose: async () => ({ lines: [{ index: 0, sku_code: other, alternative_codes: [], quantity: 5, unit: "case", confidence: 0.97 }] }) };
    r = await capture(amb, disagree);
    const dl = r.review.lines[0];
    add("F6", "model disagreeing with the rules is capped at 70 and flagged MODEL_DISAGREES", ((dl.issues as string[]) ?? []).includes("MODEL_DISAGREES") && dl.confidence <= 70, { sku: codeOf.get(dl.skuId!), confidence: dl.confidence, issues: dl.issues, rulesPick: codeOf.get(ambRules.review.lines[0].skuId!) });

    let calls = 0;
    const flaky: CaptureModel = { name: "mock-flaky", propose: async () => { calls++; throw new llm.ModelHttpError("bad gateway", 502); } };
    const breaker = new CircuitBreaker();
    await capture(msg, flaky, { breaker });
    await capture(msg, flaky, { breaker });
    const callsBefore = calls;
    r = await capture(msg, flaky, { breaker });
    add("F7", "after repeated failures the AI is paused: no model call, labelled model_paused", r.review.capture?.fallbackReason === "model_paused" && calls === callsBefore, { reason: r.review.capture?.fallbackReason, callsDuringPause: calls - callsBefore });

    // Confirmation rules on real captures
    const confirmWith = async (review: typeof rulesRef.review, over: Record<string, unknown>, lineOver: (l: (typeof review.lines)[number]) => Record<string, unknown> = () => ({})) =>
      cap.confirmCapture(db, viewer, {
        captureId: review.capture!.id,
        lines: review.lines.map((l) => ({ lineId: l.id, include: true, skuId: l.skuId, quantity: l.quantity, unit: "case", ...lineOver(l) })),
        expectedTotalPaise: 0,
        idempotencyKey: randomUUID(),
        confirmed: true,
        ...over,
      });
    const good = await capture({ retailer: "RT-1004", message: "2 peti masala noodles" }, null);
    const goodPrice = (await stockIssues("RT-1004", good.review.lines[0].skuId!, 2)).pricing!.totals.totalPaise;
    let c1 = await confirmWith(good.review, { confirmed: false });
    add("E1", "no explicit 'checked every line' tick → refused", !c1.ok && c1.error === "INVALID_INPUT", c1);
    c1 = await cap.confirmCapture(db, viewer, { captureId: good.review.capture!.id, lines: [], expectedTotalPaise: goodPrice, idempotencyKey: randomUUID(), confirmed: true });
    add("E2", "a line without a decision → refused", !c1.ok, c1.ok ? "created" : c1.error);
    const unclear = await capture({ retailer: "RT-1004", message: "10 glucose biscuit 75g" }, null);
    c1 = await confirmWith(unclear.review, { expectedTotalPaise: 1 }, () => ({ unit: "unknown" }));
    add("E3", "unit still unknown → refused (UNRESOLVED)", !c1.ok && c1.error === "UNRESOLVED", c1.ok ? "created" : c1.error);
    const oos = await capture({ retailer: "RT-1004", message: "2 peti chai patti 250 gram" }, null);
    c1 = await confirmWith(oos.review, {}, () => ({ skuId: skuIds.get("SKU-TE-250"), quantity: 2 }));
    add("E4", "out-of-stock line → refused (NOT_ORDERABLE)", !c1.ok && c1.error === "NOT_ORDERABLE", c1.ok ? "created" : c1.error);
    c1 = await confirmWith(good.review, { expectedTotalPaise: goodPrice + 1 });
    add("E5", "total changed since the desk looked → refused (PRICE_CHANGED)", !c1.ok && c1.error === "PRICE_CHANGED", c1.ok ? "created" : c1.error);
    const ok = await confirmWith(good.review, { expectedTotalPaise: goodPrice });
    const again = await confirmWith(good.review, { expectedTotalPaise: goodPrice });
    const ordersForCapture = await db.select().from(schema.orders).where(eq(schema.orders.captureId, good.review.capture!.id));
    add("E6", "valid confirmation creates exactly one order; a second confirm creates none", ok.ok && ordersForCapture.length === 1 && (!again.ok || again.duplicate === true), { first: ok.ok, second: again.ok ? (again.duplicate ? "duplicate" : "created") : again.error, orders: ordersForCapture.length });
    return out;
  }

  // ── Main ──
  const stamp = new Date().toISOString();
  if (engineArg === "rules") {
    const run = await runCases(null, "rules");
    const summary = summarise(run.results);
    writeFileSync(path.join(HERE, "results-rules.json"), JSON.stringify({ stamp, datasetSha256, ...run, summary }, null, 2));
    printCases(run.results);
    console.log("\nsetup:", JSON.stringify(run.setup), "\nhistory:", JSON.stringify(run.history));
    console.log("\nSUMMARY", JSON.stringify(summary, null, 2));
  } else if (engineArg === "fallback") {
    const out = await fallbackSuite();
    writeFileSync(path.join(HERE, "results-fallback.json"), JSON.stringify({ stamp, datasetSha256, checks: out }, null, 2));
    for (const o of out) console.log(`${o.pass ? "PASS" : "FAIL"} ${o.id} ${o.name} — ${o.detail}`);
    console.log(`\n${out.filter((o) => o.pass).length}/${out.length} passed`);
  } else {
    if (!arg("--key-rotated")) throw new Error("Gemini evaluation is opt-in: pass --key-rotated after the API key has been rotated.");
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error("GEMINI_API_KEY is not set (load it with --env-file; it is never printed).");
    const model = createCaptureModel({ AI_PROVIDER: "gemini", GEMINI_API_KEY: key, GEMINI_MODEL: process.env.GEMINI_MODEL });
    if (!model) throw new Error("Gemini model could not be created");
    const run = await runCases(model, `gemini:${model.name}`);
    const summary = summarise(run.results);
    writeFileSync(path.join(HERE, "results-gemini.json"), JSON.stringify({ stamp, datasetSha256, ...run, summary }, null, 2));
    printCases(run.results);
    console.log("\nSUMMARY", JSON.stringify(summary, null, 2));
  }
}

function printCases(results: { id: string; pass: boolean; engine?: string; fallbackReason?: string | null; ms: number; checks: { name: string; pass: boolean; detail?: string }[] }[]) {
  for (const r of results) {
    const failed = r.checks.filter((k) => !k.pass);
    console.log(`${r.pass ? "PASS" : "FAIL"} ${r.id} [${r.engine}${r.fallbackReason ? ":" + r.fallbackReason : ""}] ${r.ms}ms${failed.length ? " — " + failed.map((k) => `${k.name} (got ${k.detail})`).join("; ") : ""}`);
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("ERROR:", e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
