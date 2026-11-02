import { describe, expect, it } from "vitest";
import { en, hi } from "@/lib/i18n/messages";
import { engineNotice } from "./engine-notice";

describe("AI engine notice on the review screen (EN/HI)", () => {
  it("names the model when the AI read the message, with no retry hint", () => {
    expect(engineNotice(en.desk, { engine: "llm", model: "gemini-3.5-flash-lite", fallbackReason: null })).toEqual({
      tone: "info",
      text: "Read by AI (gemini-3.5-flash-lite). Check every line.",
      hint: null,
    });
    expect(engineNotice(hi.desk, { engine: "llm", model: "gemini-3.5-flash-lite", fallbackReason: null }).text).toBe(
      "AI (gemini-3.5-flash-lite) ने पढ़ा। हर लाइन जाँचें।",
    );
  });

  it("explains a timeout and offers a retry", () => {
    const n = engineNotice(en.desk, { engine: "rules", model: null, fallbackReason: "model_timeout" });
    expect(n).toEqual({
      tone: "warn",
      text: "Rule-based matching only — AI not used (AI did not answer within 12 seconds). Check every line.",
      hint: "Press “Re-read with AI” to try the AI again now.",
    });
    const h = engineNotice(hi.desk, { engine: "rules", model: null, fallbackReason: "model_timeout" });
    expect(h.text).toBe("सिर्फ़ नियम से मिलान — AI नहीं चला (AI ने 12 सेकंड में जवाब नहीं दिया)। हर लाइन जाँचें।");
    expect(h.hint).toBe("AI को अभी फिर आज़माने के लिए “AI से दोबारा पढ़ें” दबाएँ।");
  });

  it("explains the automatic pause and offers the manual bypass", () => {
    const n = engineNotice(en.desk, { engine: "rules", model: null, fallbackReason: "model_paused" });
    expect(n.text).toContain("AI is paused for about 2 minutes after slow or failed responses");
    expect(n.hint).toBe(en.desk.fallbackHint);
    expect(engineNotice(hi.desk, { engine: "rules", model: null, fallbackReason: "model_paused" }).text).toContain("लगभग 2 मिनट");
  });

  it("does not suggest a retry when the AI is simply not configured or the message is empty", () => {
    for (const reason of ["no_api_key", "empty_message", "no_items_found"]) {
      expect(engineNotice(en.desk, { engine: "rules", model: null, fallbackReason: reason }).hint).toBeNull();
    }
    expect(engineNotice(en.desk, { engine: "rules", model: null, fallbackReason: "no_api_key" }).text).toBe(
      "Rule-based matching only — AI not used (no API key configured). Check every line.",
    );
  });

  it("has a translated label for every fallback reason, and the 12 s loading label", () => {
    expect(Object.keys(hi.desk.fallback).sort()).toEqual(Object.keys(en.desk.fallback).sort());
    expect(en.desk.fallback).toHaveProperty("model_paused");
    expect(en.desk.running).toBe("Reading with AI… (up to 12 s)");
    expect(hi.desk.running).toBe("AI से पढ़ रहे हैं… (12 सेकंड तक)");
  });
});
