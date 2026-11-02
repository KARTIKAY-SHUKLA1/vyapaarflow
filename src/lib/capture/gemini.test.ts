import { afterEach, describe, expect, it, vi } from "vitest";
import { captureOrder } from "./capture";
import {
  createGeminiModel,
  GEMINI_DEFAULT_MODEL,
  GEMINI_OUTPUT_SCHEMA,
  readGeminiReply,
  toGeminiSchema,
} from "./gemini";
import {
  ModelBlockedError,
  ModelIncompleteError,
  ModelOutputError,
  ModelTimeoutError,
  OUTPUT_SCHEMA,
  renderUserPrompt,
  SYSTEM_PROMPT,
  type ModelRequest,
} from "./llm";
import { createCaptureModel } from "./providers";
import { allKeys, answer, BRIEF_MESSAGE, input } from "./test-fixtures";

// Every call is mocked; src/test/no-network.ts makes any unmocked fetch throw.
const KEY = "AIza-test-secret-key-123";
const ENV = { GEMINI_API_KEY: KEY };
const FORBIDDEN_KEY = /price|paise|rate|stock|scheme|discount|total|free|gst/i;

const REQ: ModelRequest = {
  message: "5 peti biscuit chhota",
  segments: [{ index: 0, originalText: "5 peti biscuit chhota", quantity: 5, unit: "case", candidates: [{ code: "SKU-BS-075", name: "Biscuit 75g" }] }],
  pastSkus: [],
};
const OK_ANSWER = answer([{ index: 0, sku_code: "SKU-BS-075", quantity: 5, unit: "case", confidence: 0.9 }]);

/** A generateContent reply carrying `text` as the model's answer. */
function reply(text: string, finishReason = "STOP", extraParts: { text: string; thought?: boolean }[] = []) {
  return { candidates: [{ finishReason, content: { role: "model", parts: [...extraParts, { text }] } }] };
}

function stubFetch(payload: unknown, status = 200) {
  const fetchMock = vi.fn<typeof fetch>(async () => new Response(typeof payload === "string" ? payload : JSON.stringify(payload), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
const call = (m: ReturnType<typeof stubFetch>) => ({ url: String(m.mock.calls[0][0]), init: m.mock.calls[0][1]!, body: JSON.parse(m.mock.calls[0][1]!.body as string) });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("toGeminiSchema", () => {
  it("collapses nullable anyOf into Gemini type arrays", () => {
    expect(toGeminiSchema({ anyOf: [{ type: "string" }, { type: "null" }] })).toEqual({ type: ["string", "null"] });
  });

  it("converts the capture output schema without any anyOf, keeping enum / required / additionalProperties", () => {
    const json = JSON.stringify(GEMINI_OUTPUT_SCHEMA);
    expect(json).not.toContain("anyOf");
    const item = (GEMINI_OUTPUT_SCHEMA as { properties: { lines: { items: Record<string, unknown> } } }).properties.lines.items as {
      properties: Record<string, { type: unknown; enum?: string[] }>;
      required: string[];
      additionalProperties: boolean;
    };
    expect(item.properties.sku_code.type).toEqual(["string", "null"]);
    expect(item.properties.quantity.type).toEqual(["integer", "null"]);
    expect(item.properties.unit.enum).toEqual(["case", "piece", "unknown"]);
    expect(item.required).toEqual(["index", "sku_code", "alternative_codes", "quantity", "unit", "confidence", "note"]);
    expect(item.additionalProperties).toBe(false);
    expect((GEMINI_OUTPUT_SCHEMA as { additionalProperties: boolean }).additionalProperties).toBe(false);
  });

  it("does not mutate the shared schema", () => {
    const before = JSON.stringify(OUTPUT_SCHEMA);
    toGeminiSchema(OUTPUT_SCHEMA);
    expect(JSON.stringify(OUTPUT_SCHEMA)).toBe(before);
    expect(before).toContain("anyOf");
  });

  it("refuses anyOf it cannot represent faithfully", () => {
    expect(() => toGeminiSchema({ anyOf: [{ type: "string" }, { type: "object", properties: {} }] })).toThrow();
  });
});

describe("createGeminiModel configuration", () => {
  it("is null without a key", () => {
    expect(createGeminiModel({})).toBeNull();
    expect(createGeminiModel({ GEMINI_API_KEY: "  " })).toBeNull();
  });

  it("defaults to the verified stable Flash model and accepts an override", () => {
    expect(createGeminiModel(ENV)?.name).toBe(GEMINI_DEFAULT_MODEL);
    expect(GEMINI_DEFAULT_MODEL).toBe("gemini-3.8-flash");
    expect(createGeminiModel({ ...ENV, GEMINI_MODEL: "gemini-3.5-flash-lite" })?.name).toBe("gemini-3.5-flash-lite");
  });

  it("rejects model ids that could alter the URL path", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const bad of ["../models/x", "gemini flash", "gemini-3.8-flash:streamGenerateContent", "Gemini?key=1"]) {
      expect(createGeminiModel({ ...ENV, GEMINI_MODEL: bad })).toBeNull();
    }
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls.flat().join(" ")).not.toContain(KEY);
  });

  it("maps the thinking level and falls back to LOW on an unknown value", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const m1 = stubFetch(reply(JSON.stringify(OK_ANSWER)));
    await createGeminiModel({ ...ENV, GEMINI_THINKING_LEVEL: "medium" })!.propose(REQ);
    expect(call(m1).body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "MEDIUM" });

    const m2 = stubFetch(reply(JSON.stringify(OK_ANSWER)));
    await createGeminiModel({ ...ENV, GEMINI_THINKING_LEVEL: "extreme" })!.propose(REQ);
    expect(call(m2).body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "LOW" });
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe("Gemini request", () => {
  it("calls generateContent with the key in a header, structured output and no temperature", async () => {
    const fetchMock = stubFetch(reply(JSON.stringify(OK_ANSWER)));
    await createGeminiModel(ENV)!.propose(REQ);
    const { url, init, body } = call(fetchMock);

    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent");
    expect(url).not.toContain(KEY);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe(KEY);

    expect(body.systemInstruction).toEqual({ parts: [{ text: SYSTEM_PROMPT }] });
    expect(body.contents).toEqual([{ role: "user", parts: [{ text: renderUserPrompt(REQ) }] }]);
    expect(body.generationConfig).toMatchObject({
      responseMimeType: "application/json",
      responseJsonSchema: GEMINI_OUTPUT_SCHEMA,
      thinkingConfig: { thinkingLevel: "LOW" },
    });
    expect(body.generationConfig).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("safetySettings"); // provider defaults are kept, never loosened
  });

  it("sends no prices, stock, schemes or totals — only words, codes and names", async () => {
    const fetchMock = stubFetch(reply(JSON.stringify(OK_ANSWER)));
    await createGeminiModel(ENV)!.propose(REQ);
    const body = call(fetchMock).body;
    const sentKeys = allKeys(JSON.parse(body.contents[0].parts[0].text.match(/<segments>\n([\s\S]*?)\n<\/segments>/)[1]));
    expect(sentKeys.filter((k) => FORBIDDEN_KEY.test(k))).toEqual([]);
    expect(allKeys(body).filter((k) => FORBIDDEN_KEY.test(k))).toEqual([]);
  });
});

describe("Gemini replies", () => {
  it("returns the parsed JSON answer", async () => {
    stubFetch(reply(JSON.stringify(OK_ANSWER)));
    await expect(createGeminiModel(ENV)!.propose(REQ)).resolves.toEqual(OK_ANSWER);
  });

  it("ignores thought parts and joins split text parts; accepts fenced JSON", async () => {
    const text = JSON.stringify(OK_ANSWER);
    stubFetch({
      candidates: [
        {
          finishReason: "STOP",
          content: { parts: [{ text: "thinking about biscuits…", thought: true }, { text: text.slice(0, 20) }, { text: text.slice(20) }] },
        },
      ],
    });
    await expect(createGeminiModel(ENV)!.propose(REQ)).resolves.toEqual(OK_ANSWER);
    expect(readGeminiReply(reply("```json\n" + text + "\n```"))).toEqual(OK_ANSWER);
  });

  it("rejects invalid JSON, empty text and missing candidates as unusable output", async () => {
    stubFetch(reply("{ not json"));
    await expect(createGeminiModel(ENV)!.propose(REQ)).rejects.toBeInstanceOf(ModelOutputError);
    expect(() => readGeminiReply(reply("   "))).toThrow(ModelOutputError);
    expect(() => readGeminiReply({ candidates: [] })).toThrow(ModelOutputError);
    expect(() => readGeminiReply({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "x", thought: true }] } }] })).toThrow(ModelOutputError);
    stubFetch("<html>bad gateway</html>");
    await expect(createGeminiModel(ENV)!.propose(REQ)).rejects.toBeInstanceOf(ModelOutputError);
  });

  it.each(["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION"])("treats finishReason %s as a block", async (reason) => {
    stubFetch(reply(JSON.stringify(OK_ANSWER), reason));
    await expect(createGeminiModel(ENV)!.propose(REQ)).rejects.toBeInstanceOf(ModelBlockedError);
  });

  it("treats a blocked prompt (no candidates, promptFeedback.blockReason) as a block", async () => {
    stubFetch({ promptFeedback: { blockReason: "SAFETY" } });
    await expect(createGeminiModel(ENV)!.propose(REQ)).rejects.toBeInstanceOf(ModelBlockedError);
  });

  it("treats MAX_TOKENS as incomplete, even if the partial text parses", async () => {
    stubFetch(reply(JSON.stringify(OK_ANSWER), "MAX_TOKENS"));
    await expect(createGeminiModel(ENV)!.propose(REQ)).rejects.toBeInstanceOf(ModelIncompleteError);
  });

  it("rejects other finish reasons", async () => {
    stubFetch(reply(JSON.stringify(OK_ANSWER), "OTHER"));
    await expect(createGeminiModel(ENV)!.propose(REQ)).rejects.toBeInstanceOf(ModelOutputError);
    expect(() => readGeminiReply({ candidates: [{ content: { parts: [{ text: "{}" }] } }] })).toThrow(ModelOutputError);
  });
});

describe("Gemini failures never leak the key", () => {
  it.each([400, 401, 403, 429, 500, 503])("HTTP %i reports the status only", async (status) => {
    stubFetch(`{"error":{"message":"API key ${KEY} invalid","details":"echo of request"}}`, status);
    const err = (await createGeminiModel(ENV)!.propose(REQ).catch((e: Error) => e)) as Error;
    expect(err.message).toBe(`Gemini returned HTTP ${status}`);
    expect(err.message).not.toContain(KEY);
    expect(String(err.stack)).not.toContain(KEY);
  });

  it("network errors are replaced by a generic message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError(`connect failed https://x?key=${KEY}`))));
    const err = (await createGeminiModel(ENV)!.propose(REQ).catch((e: Error) => e)) as Error;
    expect(err.message).toBe("Gemini request failed (network)");
    expect(err.message).not.toContain(KEY);
  });

  it("times out with ModelTimeoutError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_, reject) => init.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))),
    );
    await expect(createGeminiModel(ENV, { timeoutMs: 20 })!.propose(REQ)).rejects.toBeInstanceOf(ModelTimeoutError);
  });
});

describe("provider selection", () => {
  it("selects Gemini explicitly or when only GEMINI_API_KEY is configured", () => {
    expect(createCaptureModel({ AI_PROVIDER: "gemini", ...ENV })?.name).toBe("gemini-3.8-flash");
    expect(createCaptureModel({ ...ENV })?.name).toBe("gemini-3.8-flash");
    expect(createCaptureModel({ AI_PROVIDER: "gemini" })).toBeNull(); // no key → rules
  });

  it("keeps Anthropic first when both keys are set, and honours explicit choices", () => {
    expect(createCaptureModel({ ANTHROPIC_API_KEY: "a", ...ENV })?.name).not.toMatch(/^gemini/);
    expect(createCaptureModel({ AI_PROVIDER: "gemini", ANTHROPIC_API_KEY: "a", ...ENV })?.name).toBe("gemini-3.8-flash");
    expect(createCaptureModel({ AI_PROVIDER: "none", ...ENV })).toBeNull();
    expect(createCaptureModel({ AI_PROVIDER: "openai-compatible", ...ENV })).toBeNull(); // not configured
  });
});

describe("through captureOrder (all safety checks still apply to Gemini output)", () => {
  it("captures the brief's message with Gemini", async () => {
    stubFetch(
      reply(
        JSON.stringify(
          answer([
            { index: 0, sku_code: "SKU-BS-075", quantity: 5, unit: "case", confidence: 0.86, alternative_codes: ["SKU-BS-200", "SKU-BC-075"] },
            { index: 1, sku_code: "SKU-DT-1KG", quantity: 2, unit: "case", confidence: 0.95 },
            { index: 2, sku_code: "SKU-TE-250", quantity: 1, unit: "case", confidence: 0.97 },
          ]),
        ),
      ),
    );
    const res = await captureOrder(input(BRIEF_MESSAGE), { model: createGeminiModel(ENV) });
    expect(res).toMatchObject({ engine: "llm", model: "gemini-3.8-flash", fallbackReason: null });
    expect(res.lines.map((l) => [l.skuId, l.quantity, l.unit])).toEqual([
      ["SKU-BS-075", 5, "case"],
      ["SKU-DT-1KG", 2, "case"],
      ["SKU-TE-250", 1, "case"],
    ]);
    expect(res.lines.every((l) => l.alternatives.length === 2)).toBe(true);
    expect(res.lines.every((l) => !("price" in l))).toBe(true);
  });

  it("drops invented SKUs, never takes the unit or an unwritten quantity from Gemini", async () => {
    stubFetch(
      reply(
        JSON.stringify(
          answer([
            { index: 0, sku_code: "SKU-XX-999", quantity: 50, unit: "case", confidence: 0.99 }, // invented code + quantity
            { index: 1, sku_code: "SKU-TE-500", quantity: 5, unit: "case", confidence: 0.99 }, // unit not written
          ]),
        ),
      ),
    );
    const res = await captureOrder(input("10 peti glucose biscuit, 5 chai patti 500 gram"), { model: createGeminiModel(ENV) });
    const [first, second] = res.lines;
    expect(first.issues).toContain("MODEL_INVALID_SKU");
    expect(first.skuId).not.toBe("SKU-XX-999");
    expect(first.quantity).toBe(10);
    expect(second).toMatchObject({ skuId: "SKU-TE-500", unit: "unknown" });
    expect(second.issues).toContain("UNIT_UNCLEAR");
  });

  it("keeps a saved alias over Gemini's pick", async () => {
    stubFetch(reply(JSON.stringify(answer([{ index: 0, sku_code: "SKU-BS-075", quantity: 3, unit: "case", confidence: 0.99 }]))));
    const res = await captureOrder(
      { ...input("3 peti biscuit chhota"), aliases: [{ phrase: "biscuit chhota", skuId: "SKU-BC-075", unit: "case" }] },
      { model: createGeminiModel(ENV) },
    );
    expect(res.lines[0]).toMatchObject({ skuId: "SKU-BC-075", matchedBy: "alias" });
    expect(res.lines[0].issues).toContain("MODEL_DISAGREES");
  });

  it.each([
    ["blocked", { promptFeedback: { blockReason: "SAFETY" } }, "model_blocked"],
    ["cut off", reply("{}", "MAX_TOKENS"), "model_incomplete"],
    ["invalid JSON", reply("not json"), "model_invalid_output"],
  ])("falls back to the labelled rule-based matcher when Gemini is %s", async (_label, payload, reason) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    stubFetch(payload);
    const res = await captureOrder(input(BRIEF_MESSAGE), { model: createGeminiModel(ENV) });
    expect(res).toMatchObject({ engine: "rules", model: null, fallbackReason: reason });
    expect(res.lines.map((l) => l.skuId)).toEqual(["SKU-BS-075", "SKU-DT-1KG", "SKU-TE-250"]);
  });

  it("falls back on HTTP errors and timeouts", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    stubFetch("{}", 500);
    expect(await captureOrder(input(BRIEF_MESSAGE), { model: createGeminiModel(ENV) })).toMatchObject({ engine: "rules", fallbackReason: "model_error" });
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    expect(await captureOrder(input(BRIEF_MESSAGE), { model: createGeminiModel(ENV), timeoutMs: 30 })).toMatchObject({ engine: "rules", fallbackReason: "model_timeout" });
  });
});
