import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureOrder } from "./capture";
import {
  DEFAULT_MODEL,
  ModelOutputError,
  ModelTimeoutError,
  renderUserPrompt,
  SYSTEM_PROMPT,
  type ModelRequest,
} from "./llm";
import { createCaptureModel, createOpenAICompatibleModel } from "./providers";
import { allKeys, answer, BRIEF_MESSAGE, input } from "./test-fixtures";

const FORBIDDEN_KEY = /price|paise|rate|stock|scheme|discount|total|free|gst/i;
const KEY = "sk-test-secret-123";
const BASE_ENV = { AI_BASE_URL: "https://llm.example.test/v1/", AI_MODEL: "small-model", AI_API_KEY: KEY };

const REQ: ModelRequest = {
  message: "5 peti biscuit chhota",
  segments: [{ index: 0, originalText: "5 peti biscuit chhota", quantity: 5, unit: "case", candidates: [{ code: "SKU-BS-075", name: "Biscuit 75g" }] }],
  pastSkus: [],
};
const OK_ANSWER = answer([{ index: 0, sku_code: "SKU-BS-075", quantity: 5, unit: "case", confidence: 0.9 }]);

function completion(content: string | null, finish_reason = "stop") {
  return { choices: [{ finish_reason, message: { role: "assistant", content } }] };
}

/** Stub fetch with one JSON response and return the mock for request inspection. */
function stubFetch(payload: unknown, status = 200) {
  const fetchMock = vi.fn<typeof fetch>(async () =>
    new Response(typeof payload === "string" ? payload : JSON.stringify(payload), { status }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function sentBody(fetchMock: ReturnType<typeof stubFetch>) {
  return JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
}

function model(env: Record<string, string | undefined> = BASE_ENV, timeoutMs?: number) {
  const m = createOpenAICompatibleModel(env, { timeoutMs });
  if (!m) throw new Error("expected a model");
  return m;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("createCaptureModel — selection", () => {
  it.each([
    ["explicit anthropic", { AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "k", ANTHROPIC_MODEL: "claude-x" }, "claude-x"],
    ["explicit openai-compatible", { AI_PROVIDER: "openai-compatible", ...BASE_ENV, ANTHROPIC_API_KEY: "k" }, "small-model"],
    ["unset with an Anthropic key", { ANTHROPIC_API_KEY: "k", ...BASE_ENV }, DEFAULT_MODEL],
    ["unset with AI_BASE_URL and AI_MODEL", { AI_BASE_URL: "http://localhost:11434/v1", AI_MODEL: "llama3" }, "llama3"],
  ])("%s", (_label, env, name) => {
    expect(createCaptureModel(env)?.name).toBe(name);
  });

  it.each([
    ["explicit none", { AI_PROVIDER: "none", ANTHROPIC_API_KEY: "k", ...BASE_ENV }],
    ["unset with nothing configured", {}],
    ["openai-compatible without a model", { AI_PROVIDER: "openai-compatible", AI_BASE_URL: "http://localhost:11434/v1" }],
    ["anthropic without a key", { AI_PROVIDER: "anthropic" }],
  ])("%s → rules only", (_label, env) => {
    expect(createCaptureModel(env)).toBeNull();
  });

  it("an unknown provider gives rules only with one warning, never a throw", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(createCaptureModel({ AI_PROVIDER: "mystery", ...BASE_ENV })).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("openai-compatible — request", () => {
  it("posts to the chat completions URL with the prompts and a JSON schema", async () => {
    const fetchMock = stubFetch(completion(JSON.stringify(OK_ANSWER)));
    await model().propose(REQ);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://llm.example.test/v1/chat/completions");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    const body = sentBody(fetchMock);
    expect(body.model).toBe("small-model");
    expect(body.temperature).toBe(0);
    expect(body.messages).toEqual([
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: renderUserPrompt(REQ) },
    ]);
    expect(body.response_format).toMatchObject({ type: "json_schema", json_schema: { name: "order_capture", strict: true } });
    expect(allKeys(body).filter((k) => FORBIDDEN_KEY.test(k))).toEqual([]);
  });

  it("sends no Authorization header without AI_API_KEY (local servers)", async () => {
    const fetchMock = stubFetch(completion(JSON.stringify(OK_ANSWER)));
    await model({ AI_BASE_URL: "http://localhost:11434/v1", AI_MODEL: "llama3" }).propose(REQ);
    expect(fetchMock.mock.calls[0][1]?.headers).not.toHaveProperty("Authorization");
  });

  it("uses json_object mode and describes the shape in the prompt when asked", async () => {
    const fetchMock = stubFetch(completion(JSON.stringify(OK_ANSWER)));
    await model({ ...BASE_ENV, AI_JSON_MODE: "json_object" }).propose(REQ);
    const body = sentBody(fetchMock);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[0].content.startsWith(SYSTEM_PROMPT)).toBe(true);
    expect(body.messages[0].content).toContain('"alternative_codes"');
  });
});

describe("openai-compatible — response", () => {
  it("returns the parsed JSON", async () => {
    stubFetch(completion(JSON.stringify(OK_ANSWER)));
    await expect(model().propose(REQ)).resolves.toEqual(OK_ANSWER);
  });

  it("accepts JSON wrapped in ```json fences", async () => {
    stubFetch(completion("```json\n" + JSON.stringify(OK_ANSWER) + "\n```"));
    await expect(model().propose(REQ)).resolves.toEqual(OK_ANSWER);
  });

  it.each([401, 500])("HTTP %i names the status but not the key or body", async (status) => {
    stubFetch(`{"error":"bad key ${KEY} SECRET_BODY_TEXT"}`, status);
    const error = await model().propose(REQ).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(String(status));
    expect((error as Error).message).not.toContain(KEY);
    expect((error as Error).message).not.toContain("SECRET_BODY_TEXT");
  });

  it.each([
    ["a length stop", completion(JSON.stringify(OK_ANSWER), "length")],
    ["a content filter stop", completion("{}", "content_filter")],
    ["invalid JSON", completion("{not json")],
    ["empty content", completion("   ")],
    ["null content", completion(null)],
    ["no choices", { choices: [] }],
  ])("%s → ModelOutputError", async (_label, payload) => {
    stubFetch(payload);
    await expect(model().propose(REQ)).rejects.toBeInstanceOf(ModelOutputError);
  });

  it("times out with ModelTimeoutError when the endpoint never answers", async () => {
    // Resolves only when aborted, like a real fetch on a hung connection.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
      ),
    );
    await expect(model(BASE_ENV, 20).propose(REQ)).rejects.toBeInstanceOf(ModelTimeoutError);
  });
});

describe("captureOrder through an openai-compatible endpoint", () => {
  beforeEach(() => {
    vi.stubEnv("AI_PROVIDER", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("AI_BASE_URL", "http://localhost:11434/v1");
    vi.stubEnv("AI_MODEL", "llama3");
    vi.stubEnv("AI_API_KEY", "");
    vi.stubEnv("AI_JSON_MODE", "");
  });

  const briefAnswer = answer([
    { index: 0, sku_code: "SKU-BS-075", quantity: 5, unit: "case", confidence: 0.9 },
    { index: 1, sku_code: "SKU-DT-1KG", quantity: 2, unit: "case", confidence: 0.95 },
    { index: 2, sku_code: "SKU-TE-250", quantity: 1, unit: "case", confidence: 0.95 },
  ]);

  it("reads the brief message with the configured model", async () => {
    stubFetch(completion(JSON.stringify(briefAnswer)));
    const result = await captureOrder(input(BRIEF_MESSAGE));
    expect(result).toMatchObject({ engine: "llm", model: "llama3", fallbackReason: null });
    expect(result.lines.map((l) => [l.skuId, l.quantity, l.unit])).toEqual([
      ["SKU-BS-075", 5, "case"],
      ["SKU-DT-1KG", 2, "case"],
      ["SKU-TE-250", 1, "case"],
    ]);
  });

  it("falls back to rules, and says so, when the endpoint is unreachable", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))));
    const result = await captureOrder(input(BRIEF_MESSAGE));
    expect(result).toMatchObject({ engine: "rules", model: null, fallbackReason: "model_error" });
    expect(result.lines.map((l) => l.skuId)).toEqual(["SKU-BS-075", "SKU-DT-1KG", "SKU-TE-250"]);
  });
});
