import { afterEach, describe, expect, it, vi } from "vitest";
import { BREAKER_COOLDOWN_MS, BREAKER_WINDOW_MS, CircuitBreaker } from "./breaker";
import { captureOrder } from "./capture";
import { createGeminiModel } from "./gemini";
import { ModelHttpError, ModelOutputError, ModelTimeoutError, type CaptureModel } from "./llm";
import { answer, BRIEF_MESSAGE, input } from "./test-fixtures";

/** A breaker on a fake clock. */
function clocked() {
  let t = 1_000_000;
  const breaker = new CircuitBreaker({ now: () => t });
  return { breaker, advance: (ms: number) => (t += ms) };
}

describe("CircuitBreaker", () => {
  it("opens after 2 consecutive failures within 5 minutes and pauses for 2 minutes", () => {
    const { breaker, advance } = clocked();
    breaker.recordFailure();
    expect(breaker.isOpen()).toBe(false);
    advance(60_000);
    breaker.recordFailure();
    expect(breaker.isOpen()).toBe(true);
    advance(BREAKER_COOLDOWN_MS - 1);
    expect(breaker.isOpen()).toBe(true);
  });

  it("expires after the cooldown and needs 2 fresh failures to open again", () => {
    const { breaker, advance } = clocked();
    breaker.recordFailure();
    breaker.recordFailure();
    advance(BREAKER_COOLDOWN_MS);
    expect(breaker.isOpen()).toBe(false);
    expect(breaker.pausedUntil()).toBeNull();
    breaker.recordFailure();
    expect(breaker.isOpen()).toBe(false);
    breaker.recordFailure();
    expect(breaker.isOpen()).toBe(true);
  });

  it("does not open when the failures are more than 5 minutes apart", () => {
    const { breaker, advance } = clocked();
    breaker.recordFailure();
    advance(BREAKER_WINDOW_MS + 1);
    breaker.recordFailure();
    expect(breaker.isOpen()).toBe(false);
  });

  it("a success in between resets the count; a success closes an open breaker", () => {
    const { breaker } = clocked();
    breaker.recordFailure();
    breaker.recordSuccess();
    breaker.recordFailure();
    expect(breaker.isOpen()).toBe(false);
    breaker.recordFailure();
    expect(breaker.isOpen()).toBe(true);
    breaker.recordSuccess();
    expect(breaker.isOpen()).toBe(false);
  });

  it("counts concurrent failures correctly (two simultaneous timeouts open it once)", async () => {
    const { breaker } = clocked();
    await Promise.all([1, 2].map(async () => breaker.recordFailure()));
    expect(breaker.isOpen()).toBe(true);
  });
});

describe("captureOrder with a breaker", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function failing(error: () => Error): CaptureModel & { calls: number } {
    const m = {
      name: "mock-model",
      calls: 0,
      async propose() {
        m.calls++;
        throw error();
      },
    };
    return m;
  }
  const ok = (): CaptureModel & { calls: number } => {
    const m = {
      name: "mock-model",
      calls: 0,
      async propose() {
        m.calls++;
        return answer([{ index: 0, sku_code: "SKU-BS-075", quantity: 5, unit: "case", confidence: 0.9 }]);
      },
    };
    return m;
  };
  const quiet = () => vi.spyOn(console, "warn").mockImplementation(() => {});

  it.each([
    ["timeouts", () => new ModelTimeoutError("slow")],
    ["HTTP 503", () => new ModelHttpError("Gemini returned HTTP 503", 503)],
    ["HTTP 500", () => new ModelHttpError("Gemini returned HTTP 500", 500)],
  ])("after 2 %s, automatic reads skip the model and use labelled rules", async (_label, err) => {
    quiet();
    const { breaker } = clocked();
    const model = failing(err);
    for (let i = 0; i < 2; i++) await captureOrder(input(BRIEF_MESSAGE), { model, breaker });
    expect(model.calls).toBe(2);

    const paused = await captureOrder(input(BRIEF_MESSAGE), { model, breaker });
    expect(model.calls).toBe(2); // not called while paused
    expect(paused).toMatchObject({ engine: "rules", fallbackReason: "model_paused" });
    expect(paused.diagnostics).toEqual({ attemptedModel: "mock-model", attempts: 0, latencyMs: null, bypassedPause: false });
    expect(paused.lines.map((l) => l.skuId)).toEqual(["SKU-BS-075", "SKU-DT-1KG", "SKU-TE-250"]);
  });

  it("does not open on 4xx, blocked or invalid answers (provider is reachable)", async () => {
    quiet();
    const { breaker } = clocked();
    for (const err of [() => new ModelHttpError("HTTP 400", 400), () => new ModelHttpError("HTTP 429", 429), () => new ModelOutputError("bad")]) {
      await captureOrder(input(BRIEF_MESSAGE), { model: failing(err), breaker });
      await captureOrder(input(BRIEF_MESSAGE), { model: failing(err), breaker });
    }
    expect(breaker.isOpen()).toBe(false);
  });

  it("manual re-read bypasses the pause, really calls the model, and a success closes the breaker", async () => {
    quiet();
    const { breaker } = clocked();
    breaker.recordFailure();
    breaker.recordFailure();
    const model = ok();
    const res = await captureOrder(input("5 peti biscuit chhota"), { model, breaker, bypassBreaker: true });
    expect(model.calls).toBe(1);
    expect(res).toMatchObject({ engine: "llm", fallbackReason: null });
    expect(res.diagnostics.bypassedPause).toBe(true);
    expect(breaker.isOpen()).toBe(false);
  });

  it("a failed manual re-read still falls back to labelled rules (and keeps the pause)", async () => {
    quiet();
    const { breaker } = clocked();
    breaker.recordFailure();
    breaker.recordFailure();
    const model = failing(() => new ModelTimeoutError("slow"));
    const res = await captureOrder(input(BRIEF_MESSAGE), { model, breaker, bypassBreaker: true });
    expect(model.calls).toBe(1);
    expect(res).toMatchObject({ engine: "rules", fallbackReason: "model_timeout" });
    expect(breaker.isOpen()).toBe(true);
  });

  it("automatic reads resume once the pause expires", async () => {
    quiet();
    const { breaker, advance } = clocked();
    breaker.recordFailure();
    breaker.recordFailure();
    advance(BREAKER_COOLDOWN_MS);
    const model = ok();
    expect(await captureOrder(input("5 peti biscuit chhota"), { model, breaker })).toMatchObject({ engine: "llm" });
    expect(model.calls).toBe(1);
  });

  it("without a breaker nothing is ever paused (library default)", async () => {
    quiet();
    const model = failing(() => new ModelTimeoutError("slow"));
    for (let i = 0; i < 3; i++) await captureOrder(input(BRIEF_MESSAGE), { model });
    expect(model.calls).toBe(3);
  });
});

describe("capture diagnostics", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("records model, attempts (incl. the Gemini retry) and latency — never prompts or keys", async () => {
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        n++;
        if (n === 1) return new Response("{}", { status: 503 });
        const text = JSON.stringify(answer([{ index: 0, sku_code: "SKU-BS-075", quantity: 5, unit: "case", confidence: 0.9 }]));
        return new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text }] } }] }), { status: 200 });
      }),
    );
    const res = await captureOrder(input("5 peti biscuit chhota"), {
      model: createGeminiModel({ GEMINI_API_KEY: "secret-key-xyz", GEMINI_MODEL: "gemini-3.5-flash-lite" }, { retryDelayMs: 5, minRetryAttemptMs: 10 }),
    });
    expect(res.engine).toBe("llm");
    expect(res.diagnostics).toMatchObject({ attemptedModel: "gemini-3.5-flash-lite", attempts: 2, bypassedPause: false });
    expect(typeof res.diagnostics.latencyMs).toBe("number");
    const json = JSON.stringify(res.diagnostics);
    expect(json).not.toContain("secret-key-xyz");
    expect(json).not.toContain("biscuit");
    expect(Object.keys(res.diagnostics).sort()).toEqual(["attemptedModel", "attempts", "bypassedPause", "latencyMs"]);
  });

  it("is empty when no model is configured", async () => {
    const res = await captureOrder(input(BRIEF_MESSAGE), { model: null });
    expect(res.diagnostics).toEqual({ attemptedModel: null, attempts: 0, latencyMs: null, bypassedPause: false });
  });
});
