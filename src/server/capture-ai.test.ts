import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DB } from "@/db";
import { auditLog, captureLines, captures, inboundMessages, skus, users } from "@/db/schema";
import type { Viewer } from "@/lib/auth/policy";
import { CircuitBreaker, type CaptureModel } from "@/lib/capture";
import { ModelTimeoutError } from "@/lib/capture/llm";
import { testDb } from "@/test/db";
import { addManualMessage, runCapture } from "./capture";

const NOW = new Date("2026-11-02T10:00:00+05:30");
let db: DB;
let desk: Viewer;
let retailerId: string;

beforeEach(async () => {
  ({ db } = await testDb(NOW));
  const [u] = await db.select().from(users).where(eq(users.phone, "919000000100"));
  desk = { id: u.id, name: u.name, role: u.role, retailerId: null, language: u.language };
  const [r] = await db.select().from(users).where(eq(users.phone, "919000000001"));
  retailerId = r.retailerId!;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

const slow = (): CaptureModel & { calls: number } => {
  const m = {
    name: "gemini-3.5-flash-lite",
    calls: 0,
    async propose(_req: unknown, ctx?: { onAttempt?: () => void }) {
      m.calls++;
      ctx?.onAttempt?.();
      throw new ModelTimeoutError("no Gemini answer in 12000 ms");
    },
  };
  return m;
};

async function newMessage(body = "5 peti biscuit chhota, 2 peti washing powder 1 kilo") {
  const res = await addManualMessage(db, desk, { retailerId, body }, NOW);
  if (!res.ok) throw new Error("add failed");
  return res.messageId;
}

async function auditFor(messageId: string) {
  return db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.entityId, messageId), eq(auditLog.action, "capture.created")));
}

describe("runCapture: AI pause, manual bypass and history metadata", () => {
  it("records attempted model, attempts and latency in the capture history — no prompt, message or key", async () => {
    const breaker = new CircuitBreaker();
    const id = await newMessage();
    await runCapture(db, desk, id, { model: slow(), breaker, now: NOW });
    const [entry] = await auditFor(id);
    const data = entry.data as { engine: string; fallbackReason: string; ai: Record<string, unknown> };
    expect(data).toMatchObject({ engine: "rules", fallbackReason: "model_timeout" });
    expect(data.ai).toMatchObject({ attemptedModel: "gemini-3.5-flash-lite", attempts: 1, bypassedPause: false });
    expect(typeof data.ai.latencyMs).toBe("number");
    const json = JSON.stringify(entry.data);
    expect(json).not.toMatch(/biscuit|washing|peti/); // the retailer's words are not copied into the log
    expect(json).not.toMatch(/key|prompt|SYSTEM|order_message/i);
  });

  it("pauses automatic reads after 2 timeouts and labels them; manual re-read genuinely calls the model", async () => {
    const breaker = new CircuitBreaker();
    const model = slow();
    for (let i = 0; i < 2; i++) await runCapture(db, desk, await newMessage(), { model, breaker, now: NOW });
    expect(model.calls).toBe(2);

    const auto = await newMessage();
    await runCapture(db, desk, auto, { model, breaker, now: NOW });
    expect(model.calls).toBe(2); // paused: not called
    const [autoCapture] = await db.select().from(captures).where(eq(captures.messageId, auto));
    expect(autoCapture).toMatchObject({ engine: "rules", fallbackReason: "model_paused" });
    expect((await auditFor(auto))[0].data).toMatchObject({ ai: { attempts: 0, bypassedPause: false } });

    // "Re-read with AI" (force + bypassPause, as the desk action sends it)
    await runCapture(db, desk, auto, { model, breaker, force: true, bypassPause: true, now: NOW });
    expect(model.calls).toBe(3);
    const entries = await auditFor(auto);
    expect(entries.map((e) => (e.data as { ai: { bypassedPause: boolean } }).ai.bypassedPause).sort()).toEqual([false, true]);
  });

  it("a paused read still produces a reviewable draft (capture never blocked)", async () => {
    const breaker = new CircuitBreaker();
    breaker.recordFailure();
    breaker.recordFailure();
    const id = await newMessage();
    const res = await runCapture(db, desk, id, { model: slow(), breaker, now: NOW });
    expect(res.ok).toBe(true);
    const [msg] = await db.select().from(inboundMessages).where(eq(inboundMessages.id, id));
    expect(msg.status).toBe("captured");
  });
});

describe("runCapture: retailer history cannot authorise an unrelated SKU (eval F5)", () => {
  it("rejects a past-order detergent SKU the model picks for a biscuit message from RT-1004", async () => {
    const [jain] = await db.select().from(users).where(eq(users.phone, "919000000004"));
    const res = await addManualMessage(db, desk, { retailerId: jain.retailerId!, body: "10 peti glucose biscuit 75g" }, NOW);
    if (!res.ok) throw new Error("add failed");
    let sentPast: string[] = [];
    const model: CaptureModel = {
      name: "mock-model",
      async propose(req) {
        sentPast = req.pastSkus.map((p) => p.code);
        return { lines: [{ index: 0, sku_code: "SKU-DT-4KG", alternative_codes: [], quantity: 10, unit: "case", confidence: 0.99, note: "" }] };
      },
    };
    await runCapture(db, desk, res.messageId, { model, breaker: new CircuitBreaker(), now: NOW });
    expect(sentPast).toContain("SKU-DT-4KG"); // history is still sent, as context only

    const [capture] = await db.select().from(captures).where(eq(captures.messageId, res.messageId));
    expect(capture.engine).toBe("llm");
    const [line] = await db.select().from(captureLines).where(eq(captureLines.captureId, capture.id));
    const [chosen] = await db.select().from(skus).where(eq(skus.id, line.skuId!));
    expect(chosen.code).toBe("SKU-BS-075");
    expect(line.issues).toContain("MODEL_INVALID_SKU");
  });
});
