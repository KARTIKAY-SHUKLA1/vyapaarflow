import { beforeEach, describe, expect, it, vi } from "vitest";

// The SDK is mocked: there is no API key in tests and no network call is ever made.
const sdk = vi.hoisted(() => {
  class APIConnectionTimeoutError extends Error {}
  const create = vi.fn();
  const constructed: unknown[] = [];
  class Anthropic {
    static APIConnectionTimeoutError = APIConnectionTimeoutError;
    messages = { create };
    constructor(options: unknown) {
      constructed.push(options);
    }
  }
  return { Anthropic, APIConnectionTimeoutError, create, constructed };
});
vi.mock("@anthropic-ai/sdk", () => ({ default: sdk.Anthropic }));

import { createAnthropicModel, DEFAULT_MODEL, ModelOutputError, ModelTimeoutError, type ModelRequest } from "./llm";

const request: ModelRequest = {
  message: "5 peti biscuit chhota",
  segments: [
    { index: 0, originalText: "5 peti biscuit chhota", quantity: 5, unit: "case", candidates: [{ code: "SKU-BS-075", name: "Glucose biscuit 75 g" }] },
  ],
  pastSkus: [],
};

const reply = (text: string, stop_reason = "end_turn") => ({
  stop_reason,
  content: [{ type: "thinking", thinking: "" }, { type: "text", text }],
});

beforeEach(() => {
  sdk.create.mockReset();
  sdk.constructed.length = 0;
});

describe("createAnthropicModel", () => {
  it("returns null without an API key", () => {
    expect(createAnthropicModel({})).toBeNull();
    expect(createAnthropicModel({ ANTHROPIC_API_KEY: "" })).toBeNull();
  });

  it("defaults to Haiku and honours ANTHROPIC_MODEL", () => {
    expect(createAnthropicModel({ ANTHROPIC_API_KEY: "test" })?.name).toBe(DEFAULT_MODEL);
    expect(DEFAULT_MODEL).toBe("claude-haiku-5-5");
    expect(createAnthropicModel({ ANTHROPIC_API_KEY: "test", ANTHROPIC_MODEL: "claude-sonnet-5-5" })?.name).toBe(
      "claude-sonnet-5-5",
    );
  });

  it("sets a short timeout and a single retry", () => {
    createAnthropicModel({ ANTHROPIC_API_KEY: "test" });
    expect(sdk.constructed[0]).toMatchObject({ timeout: 12_000, maxRetries: 1 });
  });

  it("asks for structured JSON output and fences the message as data", async () => {
    sdk.create.mockResolvedValue(reply('{"lines":[]}'));
    const model = createAnthropicModel({ ANTHROPIC_API_KEY: "test" })!;
    await expect(model.propose(request)).resolves.toEqual({ lines: [] });

    const params = sdk.create.mock.calls[0][0];
    expect(params.model).toBe("claude-haiku-5-5");
    expect(params.output_config.format.type).toBe("json_schema");
    expect(params.output_config.format.schema.required).toEqual(["lines"]);
    expect(params.system).toMatch(/not instructions/);
    expect(params.messages[0].content).toContain("<order_message>\n5 peti biscuit chhota\n</order_message>");
    // Sampling parameters are rejected by current models; none are sent.
    expect(params).not.toHaveProperty("temperature");
  });

  it.each([
    ["refuses", reply("", "refusal")],
    ["is cut off", reply('{"lines":[', "max_tokens")],
    ["returns invalid JSON", reply("not json")],
  ])("raises ModelOutputError when the model %s", async (_label, response) => {
    sdk.create.mockResolvedValue(response);
    const model = createAnthropicModel({ ANTHROPIC_API_KEY: "test" })!;
    await expect(model.propose(request)).rejects.toBeInstanceOf(ModelOutputError);
  });

  it("maps an SDK timeout to ModelTimeoutError", async () => {
    sdk.create.mockRejectedValue(new sdk.APIConnectionTimeoutError("timed out"));
    const model = createAnthropicModel({ ANTHROPIC_API_KEY: "test" })!;
    await expect(model.propose(request)).rejects.toBeInstanceOf(ModelTimeoutError);
  });
});
