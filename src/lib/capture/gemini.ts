import {
  MODEL_TIMEOUT_MS,
  ModelBlockedError,
  ModelIncompleteError,
  ModelOutputError,
  ModelTimeoutError,
  OUTPUT_SCHEMA,
  renderUserPrompt,
  SYSTEM_PROMPT,
  type CaptureModel,
} from "./llm";

/**
 * Google Gemini adapter (Gemini Developer API, `generateContent`).
 *
 * Wire format verified against Google's API reference and the official
 * `@google/genai` SDK (Gemini Developer API mode):
 *   POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
 *   header x-goog-api-key (never the URL, so the key cannot leak via logs)
 *   body { systemInstruction, contents, generationConfig: { responseMimeType,
 *          responseJsonSchema, thinkingConfig: { thinkingLevel }, maxOutputTokens } }
 *   reply candidates[0].content.parts[].text, candidates[0].finishReason,
 *         promptFeedback.blockReason
 * `temperature` is not sent: Google documents it as ignored on Gemini 3.6 Flash
 * and newer. Like every provider, the output is untrusted and goes through
 * validate.ts (offered SKUs only, unit never from the model, quantity must be in
 * the text, one line per segment).
 */

export const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
/** Stable Flash model recommended by Google for new projects (verified Nov 2026). */
export const GEMINI_DEFAULT_MODEL = "gemini-3.8-flash";
export const GEMINI_THINKING_LEVELS = ["MINIMAL", "LOW", "MEDIUM", "HIGH"] as const;
type ThinkingLevel = (typeof GEMINI_THINKING_LEVELS)[number];
/** Short extraction: little reasoning keeps answers well inside the 12 s budget. */
const DEFAULT_THINKING: ThinkingLevel = "LOW";
const MAX_OUTPUT_TOKENS = 4096;
/** Model ids go into the URL path, so only plain ids are accepted. */
const MODEL_ID = /^[a-z0-9][a-z0-9.-]{0,63}$/;

type Env = Record<string, string | undefined>;
type JsonSchema = { [key: string]: unknown };

/**
 * Convert our JSON Schema to the subset Gemini documents. Gemini supports
 * nullable types as type arrays (`{ type: ["string", "null"] }`) but does not list
 * `anyOf`, so `anyOf` made only of plain `{ type }` members is collapsed into a
 * type array. Everything else (properties, required, enum, items,
 * additionalProperties) is kept as is. The input is never mutated.
 */
export function toGeminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (!schema || typeof schema !== "object") return schema;
  const src = schema as JsonSchema;

  const anyOf = src.anyOf;
  if (Array.isArray(anyOf) && anyOf.every((m) => m && typeof m === "object" && Object.keys(m).length === 1 && typeof (m as JsonSchema).type === "string")) {
    const { anyOf: _drop, ...rest } = src;
    void _drop;
    return { ...(toGeminiSchema(rest) as JsonSchema), type: anyOf.map((m) => (m as JsonSchema).type) };
  }
  if (Array.isArray(anyOf)) throw new Error("toGeminiSchema: only anyOf of plain types is supported");

  const out: JsonSchema = {};
  for (const [key, value] of Object.entries(src)) {
    if (key === "properties" && value && typeof value === "object") {
      out.properties = Object.fromEntries(Object.entries(value as JsonSchema).map(([k, v]) => [k, toGeminiSchema(v)]));
    } else if (key === "items") {
      out.items = toGeminiSchema(value);
    } else {
      out[key] = Array.isArray(value) ? [...value] : value;
    }
  }
  return out;
}

export const GEMINI_OUTPUT_SCHEMA = toGeminiSchema(OUTPUT_SCHEMA);

function thinkingLevel(raw: string | undefined): ThinkingLevel {
  const level = raw?.trim().toUpperCase();
  if (!level) return DEFAULT_THINKING;
  if ((GEMINI_THINKING_LEVELS as readonly string[]).includes(level)) return level as ThinkingLevel;
  console.warn(`[capture] GEMINI_THINKING_LEVEL "${raw}" is not one of ${GEMINI_THINKING_LEVELS.join(", ")}; using ${DEFAULT_THINKING}`);
  return DEFAULT_THINKING;
}

/** Finish reasons that mean Google withheld the answer on policy grounds. */
const BLOCKED_FINISH = new Set([
  "SAFETY",
  "RECITATION",
  "LANGUAGE",
  "BLOCKLIST",
  "PROHIBITED_CONTENT",
  "SPII",
  "IMAGE_SAFETY",
  "IMAGE_PROHIBITED_CONTENT",
  "IMAGE_RECITATION",
]);

type GeminiResponse = {
  candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[];
  promptFeedback?: { blockReason?: string };
};

/** Small models sometimes wrap JSON in ```json fences even in JSON mode. */
function stripFences(text: string): string {
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
  return fenced ? fenced[1] : text;
}

/** Turn a Gemini reply into the raw JSON answer, or throw a typed, key-free error. */
export function readGeminiReply(data: GeminiResponse): unknown {
  if (data.promptFeedback?.blockReason) throw new ModelBlockedError(`Gemini blocked the request (${data.promptFeedback.blockReason})`);
  const candidate = data.candidates?.[0];
  if (!candidate) throw new ModelOutputError("Gemini returned no candidates");

  const reason = candidate.finishReason ?? "FINISH_REASON_UNSPECIFIED";
  if (BLOCKED_FINISH.has(reason)) throw new ModelBlockedError(`Gemini withheld the answer (${reason})`);
  if (reason === "MAX_TOKENS") throw new ModelIncompleteError("Gemini answer was cut off (MAX_TOKENS)");
  if (reason !== "STOP") throw new ModelOutputError(`Gemini stopped with ${reason}`);

  // Thought parts (if any) are reasoning, never the answer.
  const text = (candidate.content?.parts ?? [])
    .filter((p) => !p.thought && typeof p.text === "string")
    .map((p) => p.text)
    .join("")
    .trim();
  if (!text) throw new ModelOutputError("Gemini returned no text");
  try {
    return JSON.parse(stripFences(text));
  } catch {
    throw new ModelOutputError("Gemini returned invalid JSON");
  }
}

/** HTTP statuses Google documents as temporary (rate limit / overloaded). Only these are retried. */
const TRANSIENT_STATUS = new Set([429, 503]);
/** Default pause before the single retry when Google sends no usable Retry-After. */
const RETRY_DELAY_MS = 600;
/** Never wait longer than this for a retry, whatever Retry-After says. */
const MAX_RETRY_DELAY_MS = 2000;
/** Retry only if at least this much of the budget would remain for the second attempt. */
const MIN_RETRY_ATTEMPT_MS = 3000;

/** Retry-After in seconds (the HTTP-date form is ignored); null when absent or unusable. */
function retryAfterMs(res: Response): number | null {
  const raw = res.headers.get("retry-after");
  if (!raw || !/^\d+(\.\d+)?$/.test(raw.trim())) return null;
  return Math.round(Number(raw) * 1000);
}

class HttpStatusError extends Error {}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error("aborted"));
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), reject(new Error("aborted"))), { once: true });
  });
}

export type GeminiOptions = {
  /** Whole budget for one capture, retry included (default 12 s). */
  timeoutMs?: number;
  /** Tests only: shorten the retry pause / minimum remaining budget. */
  retryDelayMs?: number;
  minRetryAttemptMs?: number;
};

/**
 * Gemini-backed capture model, or null when GEMINI_API_KEY is not set or the
 * model id is not a plain id. `opts` exists so tests need not wait seconds.
 */
export function createGeminiModel(env: Env = process.env, opts: GeminiOptions = {}): CaptureModel | null {
  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  const model = env.GEMINI_MODEL?.trim() || GEMINI_DEFAULT_MODEL;
  if (!MODEL_ID.test(model)) {
    console.warn("[capture] GEMINI_MODEL is not a valid model id; using the rule-based matcher");
    return null;
  }
  const level = thinkingLevel(env.GEMINI_THINKING_LEVEL);
  const timeoutMs = opts.timeoutMs ?? MODEL_TIMEOUT_MS;
  const retryDelay = opts.retryDelayMs ?? RETRY_DELAY_MS;
  const minRetryAttempt = opts.minRetryAttemptMs ?? MIN_RETRY_ATTEMPT_MS;

  return {
    name: model,
    async propose(req) {
      const body = {
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: renderUserPrompt(req) }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseJsonSchema: GEMINI_OUTPUT_SCHEMA,
          thinkingConfig: { thinkingLevel: level },
          maxOutputTokens: MAX_OUTPUT_TOKENS,
        },
      };

      // One deadline for the whole call, retry included: the 12 s budget never grows.
      const deadline = Date.now() + timeoutMs;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let data: GeminiResponse | undefined;
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          const res = await fetch(`${GEMINI_API_BASE}/models/${model}:generateContent`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
            body: JSON.stringify(body),
            signal: controller.signal,
          });
          if (res.ok) {
            data = (await res.json().catch(() => {
              throw new ModelOutputError("Gemini returned a non-JSON response");
            })) as GeminiResponse;
            break;
          }
          await res.body?.cancel().catch(() => {}); // free the connection; the body is never read
          // At most one retry, only for documented-transient statuses, and only if the
          // wait is short and enough budget remains for a real second attempt.
          const wait = retryAfterMs(res) ?? retryDelay;
          const left = deadline - Date.now() - wait;
          if (attempt === 0 && TRANSIENT_STATUS.has(res.status) && wait <= MAX_RETRY_DELAY_MS && left >= minRetryAttempt) {
            await sleep(wait, controller.signal);
            continue;
          }
          // Status only: error bodies can echo request details.
          throw new HttpStatusError(`Gemini returned HTTP ${res.status}`);
        }
      } catch (error) {
        if (controller.signal.aborted) throw new ModelTimeoutError(`no Gemini answer in ${timeoutMs} ms`);
        if (error instanceof ModelOutputError || error instanceof HttpStatusError) throw error;
        // Network failures: never pass through a message that could contain request details.
        throw new Error("Gemini request failed (network)");
      } finally {
        clearTimeout(timer);
      }
      if (!data) throw new ModelOutputError("Gemini returned no response");
      return readGeminiReply(data);
    },
  };
}
