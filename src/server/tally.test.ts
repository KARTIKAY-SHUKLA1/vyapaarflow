import { eq, inArray } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import { auditLog, orders, users } from "@/db/schema";
import type { Viewer } from "@/lib/auth/policy";
import { TALLY_HEADERS } from "@/lib/tally";
import { testDb } from "@/test/db";
import { transitionOrder } from "./desk";
import { createExport, getExportFile, listExportable, listExports } from "./tally";

const NOW = new Date("2026-11-02T10:00:00+05:30");
let db: DB;
let desk: Viewer;

async function viewerFor(phone: string): Promise<Viewer> {
  const [u] = await db.select().from(users).where(eq(users.phone, phone));
  return { id: u.id, name: u.name, role: u.role, retailerId: u.retailerId, language: u.language };
}

beforeEach(async () => {
  ({ db } = await testDb(NOW));
  desk = await viewerFor("919000000100");
});

describe("Tally export", () => {
  it("is desk-only, including the file download", async () => {
    const retailer = await viewerFor("919000000001");
    expect(await listExportable(db, retailer)).toEqual([]);
    expect(await listExports(db, retailer)).toEqual([]);
    expect(await createExport(db, retailer, { orderIds: ["x"] })).toEqual({ ok: false, error: "FORBIDDEN" });

    const ready = await listExportable(db, desk);
    const res = await createExport(db, desk, { orderIds: [ready[0].id] }, NOW);
    if (!res.ok) throw new Error("export failed");
    expect(await getExportFile(db, retailer, res.exportId)).toBeNull();
    expect(await getExportFile(db, null, res.exportId)).toBeNull();
  });

  it("exports approved orders, marks them exported, and the CSV matches the stored totals", async () => {
    const ready = await listExportable(db, desk);
    expect(ready.length).toBeGreaterThan(0);
    const ids = ready.map((o) => o.id);

    const res = await createExport(db, desk, { orderIds: ids }, NOW);
    expect(res).toMatchObject({ ok: true, count: ids.length });
    if (!res.ok) return;
    expect(res.fileName).toMatch(/^tally-sales-orders-2026-11-02-1000-\d+orders\.csv$/);

    const after = await db.select().from(orders).where(inArray(orders.id, ids));
    expect(after.every((o) => o.status === "exported")).toBe(true);
    expect(await db.select().from(auditLog).where(eq(auditLog.action, "order.exported_to_tally"))).toHaveLength(ids.length);

    const file = (await getExportFile(db, desk, res.exportId))!;
    const [header, ...rows] = file.csv.replace(/^﻿/, "").trimEnd().split("\r\n");
    expect(header).toBe(TALLY_HEADERS.join(","));
    for (const o of after) {
      const mine = rows.filter((r) => r.includes(`,${o.number},`));
      expect(mine.length).toBeGreaterThan(0);
      expect(mine.every((r) => r.includes(`,${(o.totalPaise / 100).toFixed(2)},`))).toBe(true);
    }
    expect((await listExports(db, desk))[0]).toMatchObject({ id: res.exportId, by: "Neha Soni" });
  });

  it("refuses orders that are not approved, and never exports an order twice", async () => {
    const [placed] = await db.select().from(orders).where(eq(orders.status, "placed"));
    expect(await createExport(db, desk, { orderIds: [placed.id] }, NOW)).toEqual({ ok: false, error: "NOT_EXPORTABLE", orderIds: [placed.id] });

    expect(await transitionOrder(db, desk, { action: "approve", orderId: placed.id }, NOW)).toMatchObject({ ok: true });
    const first = await createExport(db, desk, { orderIds: [placed.id] }, NOW);
    expect(first.ok).toBe(true);
    expect(await createExport(db, desk, { orderIds: [placed.id] }, NOW)).toEqual({ ok: false, error: "NOT_EXPORTABLE", orderIds: [placed.id] });
  });

  it("lets only one of two simultaneous exports of the same orders win", async () => {
    const ids = (await listExportable(db, desk)).map((o) => o.id);
    const results = await Promise.all([createExport(db, desk, { orderIds: ids }, NOW), createExport(db, desk, { orderIds: ids }, NOW)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await listExports(db, desk)).toHaveLength(1);
  });

  it("rejects empty or malformed requests", async () => {
    expect(await createExport(db, desk, { orderIds: [] })).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(await createExport(db, desk, {})).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(await createExport(db, desk, { orderIds: ["missing"] })).toEqual({ ok: false, error: "NOT_EXPORTABLE", orderIds: ["missing"] });
  });
});
