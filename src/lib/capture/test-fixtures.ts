import { vi } from "vitest";
import { skus } from "@/db/seed-data";
import type { CaptureModel } from "./llm";
import type { CaptureInput, CatalogueItem } from "./types";

/** The real seed catalogue, with id = code so assertions read naturally. */
export const catalogue: CatalogueItem[] = skus.map((s) => ({
  id: s.code,
  code: s.code,
  name: s.name,
  nameHi: s.nameHi,
  category: s.category,
  packSize: s.packSize,
}));

export const BRIEF_MESSAGE = "bhaiya 5 peti biscuit chhota, 2 peti washing powder 1 kilo, chai patti 250 wala 1 peti";

export function input(message: string, extra: Partial<CaptureInput> = {}): CaptureInput {
  return { message, catalogue, aliases: [], history: [], ...extra };
}

export type MockLine = {
  index: number;
  sku_code: string | null;
  alternative_codes?: string[];
  quantity: number | null;
  unit: "case" | "piece" | "unknown";
  confidence: number;
  note?: string;
};

/** A model that returns a fixed answer and records what it was sent. */
export function mockModel(output: unknown) {
  const propose = vi.fn<CaptureModel["propose"]>(async () => output);
  const model: CaptureModel = { name: "mock-model", propose };
  return { model, propose };
}

export function answer(lines: MockLine[]) {
  return { lines: lines.map((l) => ({ alternative_codes: [], note: "", ...l })) };
}

/** Every key at any depth of a JSON-like value. */
export function allKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(allKeys);
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => [k, ...allKeys(v)]);
  }
  return [];
}
