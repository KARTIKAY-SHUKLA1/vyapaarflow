import {
  createAnthropicModel,
  MODEL_TIMEOUT_MS,
  ModelHttpError,
  ModelOutputError,
  ModelTimeoutError,
  OUTPUT_SCHEMA,
  renderUserPrompt,
  SYSTEM_PROMPT,
  type CaptureModel,
} from "./llm";
import { createGeminiModel } from "./gemini";

/**
 * Provider selection. The model is swappable so the distributor can pick an
 * affordable API; whichever is used, its output is still untrusted and goes
 * through validate.ts. Selection never throws: a bad config means rules only.
 */

type Env = Record<string, string | undefined>;

export function createCaptureModel(env: Env = process.env): CaptureModel | null {
  const provider = env.AI_PROVIDER?.trim().toLowerCase();
  switch (provider) {
    case "anthropic":
      return createAnthropicModel(env);
    case "gemini":
      return createGeminiModel(env);
    case "openai-compatible":
      return createOpenAICompatibleModel(env);
    case "none":
      return null;
    case undefined:
    case "":
      // Unset: use whatever is configured, Anthropic first for backwards compatibility.
      if (env.ANTHROPIC_API_KEY) return createAnthropicModel(env);
      if (env.GEMINI_API_KEY) return createGeminiModel(env);
      if (env.AI_BASE_URL && env.AI_MODEL) return createOpenAICompatibleModel(env);
      return null;
    default:
      console.warn(`[capture] unknown AI_PROVIDER "${provider}"; using the rule-based matcher`);
      return null;
  }
}

/** Some providers lack JSON-schema mode; there the shape has to be stated in the prompt. */
const JSON_OBJECT_HINT = `\n\nReply with only a JSON object, no other text, that matches this JSON schema exactly: ${JSON.stringify(OUTPUT_SCHEMA)}`;

type ChatCompletion = {
  choices?: { finish_reason?: string | null; message?: { content?: string | null } }[];
};

/** Small models sometimes wrap JSON in ```json fences despite being told not to. */
function stripFences(text: string): string {
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
  return fenced ? fenced[1] : text;
}

/**
 * Any OpenAI-compatible Chat Completions endpoint (OpenRouter, Groq, Together,
 * a local Ollama or LM Studio, ...). Null when AI_BASE_URL or AI_MODEL is missing.
 * `opts.timeoutMs` exists so tests need not wait the full budget.
 */
export function createOpenAICompatibleModel(
  env: Env = process.env,
  opts: { timeoutMs?: number } = {},
): CaptureModel | null {
  const base = env.AI_BASE_URL?.trim().replace(/\/+$/, "");
  const model = env.AI_MODEL?.trim();
  if (!base || !model) return null;
  const apiKey = env.AI_API_KEY?.trim();
  const jsonObjectMode = env.AI_JSON_MODE?.trim().toLowerCase() === "json_object";
  const timeoutMs = opts.timeoutMs ?? MODEL_TIMEOUT_MS;

  return {
    name: model,
    async propose(req, ctx) {
      ctx?.onAttempt?.();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      // Local servers need no key; only send one when configured.
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
      const body = {
        model,
        temperature: 0,
        messages: [
          { role: "system", content: SYSTEM_PROMPT + (jsonObjectMode ? JSON_OBJECT_HINT : "") },
          { role: "user", content: renderUserPrompt(req) },
        ],
        response_format: jsonObjectMode
          ? { type: "json_object" }
          : { type: "json_schema", json_schema: { name: "order_capture", strict: true, schema: OUTPUT_SCHEMA } },
      };

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let data: ChatCompletion;
      try {
        const res = await fetch(`${base}/chat/completions`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        // Status only: provider error bodies can echo request details.
        if (!res.ok) throw new ModelHttpError(`model endpoint returned HTTP ${res.status}`, res.status);
        data = (await res.json().catch(() => {
          throw new ModelOutputError("model endpoint returned a non-JSON response");
        })) as ChatCompletion;
      } catch (error) {
        if (controller.signal.aborted) throw new ModelTimeoutError(`no model answer in ${timeoutMs} ms`);
        throw error;
      } finally {
        clearTimeout(timer);
      }

      const choice = data.choices?.[0];
      // "length" or "content_filter" can leave partial output that does not match the schema.
      if (choice?.finish_reason !== "stop") {
        throw new ModelOutputError(`model stopped with ${choice?.finish_reason ?? "no choice"}`);
      }
      const content = choice.message?.content?.trim();
      if (!content) throw new ModelOutputError("model returned no content");
      try {
        return JSON.parse(stripFences(content));
      } catch {
        throw new ModelOutputError("model returned invalid JSON");
      }
    },
  };
}
