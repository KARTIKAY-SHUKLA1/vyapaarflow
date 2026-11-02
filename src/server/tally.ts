import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db";
import { auditLog, orderLines, orders, retailers, skus, tallyExports, users } from "@/db/schema";
import type { Viewer } from "@/lib/auth/policy";
import { buildTallyCsv, tallyFileName, type TallyOrder } from "@/lib/tally";
import { isDesk } from "./desk";
import { withBusyRetry } from "./orders";

/** Orders ready for Tally: approved by the desk, not yet exported. */
export async function listExportable(db: DB, viewer: Viewer) {
  if (!isDesk(viewer)) return [];
  return db
    .select({
      id: orders.id,
      number: orders.number,
      createdAt: orders.createdAt,
      totalPaise: orders.totalPaise,
      source: orders.source,
      shopName: retailers.shopName,
      retailerCode: retailers.code,
    })
    .from(orders)
    .innerJoin(retailers, eq(retailers.id, orders.retailerId))
    .where(eq(orders.status, "approved"))
    .orderBy(orders.createdAt);
}

export async function listExports(db: DB, viewer: Viewer, limit = 20) {
  if (!isDesk(viewer)) return [];
  return db
    .select({ id: tallyExports.id, fileName: tallyExports.fileName, orderIds: tallyExports.orderIds, createdAt: tallyExports.createdAt, by: users.name })
    .from(tallyExports)
    .leftJoin(users, eq(users.id, tallyExports.createdById))
    .orderBy(desc(tallyExports.createdAt))
    .limit(limit);
}

async function loadTallyOrders(db: Pick<DB, "select">, orderIds: string[]): Promise<TallyOrder[]> {
  const rows = await db
    .select({ order: orders, retailerCode: retailers.code, shopName: retailers.shopName })
    .from(orders)
    .innerJoin(retailers, eq(retailers.id, orders.retailerId))
    .where(inArray(orders.id, orderIds))
    .orderBy(orders.createdAt, orders.number);
  const lines = await db
    .select({ line: orderLines, code: skus.code, name: skus.name })
    .from(orderLines)
    .innerJoin(skus, eq(skus.id, orderLines.skuId))
    .where(inArray(orderLines.orderId, orderIds))
    .orderBy(skus.code);
  return rows.map(({ order, retailerCode, shopName }) => ({
    number: order.number,
    createdAt: order.createdAt,
    retailerCode,
    shopName,
    note: order.note,
    source: order.source,
    totals: { grossPaise: order.grossPaise, discountPaise: order.discountPaise, taxablePaise: order.taxablePaise, gstPaise: order.gstPaise, totalPaise: order.totalPaise },
    lines: lines
      .filter((l) => l.line.orderId === order.id)
      .map(({ line, code, name }) => ({
        skuCode: code,
        skuName: name,
        cases: line.cases,
        freeCases: line.freeCases,
        packSize: line.packSize,
        pricePerPiecePaise: line.pricePerPiecePaise,
        grossPaise: line.grossPaise,
        discountPaise: line.discountPaise,
        gstRateBp: line.gstRateBp,
        gstPaise: line.gstPaise,
        totalPaise: line.totalPaise,
        schemeNote: line.schemeNote,
      })),
  }));
}

export const exportSchema = z.object({ orderIds: z.array(z.string().min(1).max(64)).min(1).max(500) });

export type ExportResult =
  | { ok: true; exportId: string; fileName: string; count: number }
  | { ok: false; error: "FORBIDDEN" | "INVALID_INPUT" | "INCONSISTENT" }
  | { ok: false; error: "NOT_EXPORTABLE"; orderIds: string[] };

class ExportRaceError extends Error {}

/**
 * Export approved orders to a Tally CSV. The CSV is built (and its money checked)
 * before anything changes; then the orders flip approved → exported in one
 * transaction, conditional on still being approved, so an order can never be
 * exported twice — even by two desk users at once.
 */
export async function createExport(db: DB, viewer: Viewer, raw: unknown, now = new Date()): Promise<ExportResult> {
  if (!isDesk(viewer)) return { ok: false, error: "FORBIDDEN" };
  const parsed = exportSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  const ids = [...new Set(parsed.data.orderIds)];

  const found = await db.select({ id: orders.id, status: orders.status }).from(orders).where(inArray(orders.id, ids));
  const notReady = ids.filter((id) => found.find((f) => f.id === id)?.status !== "approved");
  if (notReady.length) return { ok: false, error: "NOT_EXPORTABLE", orderIds: notReady };

  try {
    buildTallyCsv(await loadTallyOrders(db, ids)); // validates money before we commit anything
  } catch {
    return { ok: false, error: "INCONSISTENT" };
  }
  const fileName = tallyFileName(now, ids.length);

  try {
    return await withBusyRetry(() =>
      db.transaction(async (tx) => {
        const flipped = await tx
          .update(orders)
          .set({ status: "exported", updatedAt: now })
          .where(and(inArray(orders.id, ids), eq(orders.status, "approved")))
          .returning({ id: orders.id });
        if (flipped.length !== ids.length) throw new ExportRaceError();
        const [exp] = await tx
          .insert(tallyExports)
          .values({ fileName, format: "csv", orderIds: ids, createdById: viewer.id, createdAt: now })
          .returning({ id: tallyExports.id });
        await tx.insert(auditLog).values(
          ids.map((id) => ({ actorId: viewer.id, action: "order.exported_to_tally", entity: "order", entityId: id, data: { exportId: exp.id, fileName }, createdAt: now })),
        );
        return { ok: true as const, exportId: exp.id, fileName, count: ids.length };
      }),
    );
  } catch (error) {
    if (!(error instanceof ExportRaceError)) throw error;
    const again = await db.select({ id: orders.id, status: orders.status }).from(orders).where(inArray(orders.id, ids));
    return { ok: false, error: "NOT_EXPORTABLE", orderIds: ids.filter((id) => again.find((a) => a.id === id)?.status !== "approved") };
  }
}

/** Re-create an export file. Exported orders are frozen, so the file is identical every time. */
export async function getExportFile(db: DB, viewer: Viewer | null, exportId: string) {
  if (!isDesk(viewer)) return null;
  const [exp] = await db.select().from(tallyExports).where(eq(tallyExports.id, exportId));
  if (!exp) return null;
  return { fileName: exp.fileName, csv: buildTallyCsv(await loadTallyOrders(db, exp.orderIds)) };
}
