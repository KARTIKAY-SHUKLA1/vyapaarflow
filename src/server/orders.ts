import { and, desc, eq, gte, like, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db";
import { auditLog, orderLines, orders, retailers, skus, stock, type OrderSource, type OrderStatus } from "@/db/schema";
import { canAccessRetailer, type Viewer } from "@/lib/auth/policy";
import { formatPaise } from "@/lib/money";
import { isoDateIST } from "@/lib/pricing";
import { cartSchema, priceCart, type CartPricing } from "./pricing";

export const placeOrderSchema = z.object({
  lines: cartSchema.min(1),
  /** The incl.-GST total the retailer saw. Used only to detect a change, never as a price. */
  expectedTotalPaise: z.number().int().min(0),
  idempotencyKey: z.uuid(),
  note: z.string().trim().max(300).optional(),
});
export type PlaceOrderInput = z.infer<typeof placeOrderSchema>;

export type PlaceOrderResult =
  | { ok: true; orderId: string; number: string; status: OrderStatus; duplicate: boolean }
  | { ok: false; error: "FORBIDDEN" | "INVALID_INPUT" }
  | { ok: false; error: "NOT_ORDERABLE" | "PRICE_CHANGED" | "STOCK_CHANGED"; pricing: CartPricing };

class StockChangedError extends Error {}

async function existingOrder(db: DB, retailerId: string, key: string) {
  const [o] = await db
    .select({ id: orders.id, number: orders.number, status: orders.status })
    .from(orders)
    .where(and(eq(orders.retailerId, retailerId), eq(orders.idempotencyKey, key)));
  return o ?? null;
}

/** SO-YYMM-NNNN, sequential per month (IST). Called inside the write transaction. */
async function nextOrderNumber(tx: Pick<DB, "select">, now: Date): Promise<string> {
  const prefix = `SO-${isoDateIST(now).slice(2, 7).replace("-", "")}-`;
  const [row] = await tx
    .select({ max: sql<string | null>`max(${orders.number})` })
    .from(orders)
    .where(like(orders.number, `${prefix}%`));
  const last = row?.max ? Number(row.max.slice(prefix.length)) : 0;
  return `${prefix}${String(last + 1).padStart(4, "0")}`;
}

/**
 * Place a retailer's order. Everything is recomputed on the server:
 * - the retailer is the signed-in viewer (no retailer id is accepted from the client);
 * - prices, schemes, GST, stock and credit come from the database via the pricing engine;
 * - if the total differs from what the retailer saw, nothing is written (PRICE_CHANGED);
 * - stock is reserved with a conditional update, so a concurrent order can never
 *   take the same cases (STOCK_CHANGED, whole transaction rolled back);
 * - the idempotency key makes double taps and retries return the same order;
 * - over the credit limit → status credit_hold for the desk, never auto-rejected (A7).
 */
export async function placeOrder(
  db: DB,
  viewer: Viewer,
  rawInput: unknown,
  opts: { now?: Date; source?: OrderSource } = {},
): Promise<PlaceOrderResult> {
  if (viewer.role !== "retailer" || !viewer.retailerId) return { ok: false, error: "FORBIDDEN" };
  const parsed = placeOrderSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  const now = opts.now ?? new Date();

  // SQLite allows one writer at a time; a simultaneous double tap can hit a
  // locked database. Retry with backoff: the next attempt's idempotency check
  // then finds the first order and returns it, so the retailer never sees an error.
  for (let attempt = 0; ; attempt++) {
    try {
      return await attemptPlace(db, viewer, viewer.retailerId, parsed.data, now, opts.source ?? "app");
    } catch (error) {
      if (!isBusy(error) || attempt >= BUSY_RETRIES) throw error;
      await new Promise((r) => setTimeout(r, 40 * 2 ** attempt + Math.random() * 40));
    }
  }
}

const BUSY_RETRIES = 6;

function isBusy(error: unknown): boolean {
  for (let e = error; e instanceof Error; e = (e as Error & { cause?: unknown }).cause) {
    if ((e as { code?: string }).code === "SQLITE_BUSY" || /database is locked/i.test(e.message)) return true;
  }
  return false;
}

async function attemptPlace(
  db: DB,
  viewer: Viewer,
  retailerId: string,
  input: PlaceOrderInput,
  now: Date,
  source: OrderSource,
): Promise<PlaceOrderResult> {
  const previous = await existingOrder(db, retailerId, input.idempotencyKey);
  if (previous) return { ok: true, orderId: previous.id, number: previous.number, status: previous.status, duplicate: true };

  const pricing = await priceCart(db, retailerId, input.lines, isoDateIST(now));
  if (!pricing) return { ok: false, error: "FORBIDDEN" };
  if (!pricing.orderable) return { ok: false, error: "NOT_ORDERABLE", pricing };
  if (pricing.totals.totalPaise !== input.expectedTotalPaise) return { ok: false, error: "PRICE_CHANGED", pricing };

  const status: OrderStatus = pricing.credit.wouldExceed ? "credit_hold" : "placed";
  const holdReason = pricing.credit.wouldExceed
    ? `Over credit limit by ${formatPaise(pricing.credit.exceedsByPaise)} (outstanding + open orders + this order)`
    : null;

  try {
    const created = await db.transaction(async (tx) => {
      for (const line of pricing.lines) {
        const need = line.cases + line.freeCases; // free cases ship too (A3)
        const updated = await tx
          .update(stock)
          .set({ cases: sql`${stock.cases} - ${need}`, updatedAt: now })
          .where(and(eq(stock.skuId, line.skuId), gte(stock.cases, need)))
          .returning({ skuId: stock.skuId });
        if (updated.length === 0) throw new StockChangedError(line.skuId);
      }

      const number = await nextOrderNumber(tx, now);
      const [order] = await tx
        .insert(orders)
        .values({
          number,
          retailerId,
          source,
          status,
          grossPaise: pricing.totals.grossPaise,
          discountPaise: pricing.totals.discountPaise,
          taxablePaise: pricing.totals.taxablePaise,
          gstPaise: pricing.totals.gstPaise,
          totalPaise: pricing.totals.totalPaise,
          idempotencyKey: input.idempotencyKey,
          creditExposurePaise: pricing.credit.position.exposurePaise,
          note: input.note || null,
          holdReason,
          createdById: viewer.id,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: orders.id, number: orders.number, status: orders.status });

      await tx.insert(orderLines).values(
        pricing.lines.map((l) => ({
          orderId: order.id,
          skuId: l.skuId,
          cases: l.cases,
          freeCases: l.freeCases,
          packSize: l.item.packSize,
          pricePerPiecePaise: l.item.pricePerPiecePaise,
          grossPaise: l.grossPaise,
          discountPaise: l.discountPaise,
          gstRateBp: l.gstRateBp,
          gstPaise: l.gstPaise,
          totalPaise: l.totalPaise,
          schemeId: l.appliedScheme?.id ?? null,
          schemeNote: l.appliedScheme?.label ?? null,
        })),
      );

      await tx.insert(auditLog).values({
        actorId: viewer.id,
        action: status === "credit_hold" ? "order.placed_on_credit_hold" : "order.placed",
        entity: "order",
        entityId: order.id,
        data: { number, totalPaise: pricing.totals.totalPaise, lines: pricing.lines.length },
        createdAt: now,
      });
      return order;
    });
    return { ok: true, orderId: created.id, number: created.number, status: created.status, duplicate: false };
  } catch (error) {
    if (error instanceof StockChangedError) {
      const fresh = await priceCart(db, retailerId, input.lines, isoDateIST(now));
      return { ok: false, error: "STOCK_CHANGED", pricing: fresh ?? pricing };
    }
    if (isBusy(error)) throw error; // retried by placeOrder
    // A concurrent submit with the same key won the race (unique index): return its order.
    const raced = await existingOrder(db, retailerId, input.idempotencyKey);
    if (raced) return { ok: true, orderId: raced.id, number: raced.number, status: raced.status, duplicate: true };
    throw error;
  }
}

export type OrderSummary = {
  id: string;
  number: string;
  status: OrderStatus;
  source: OrderSource;
  totalPaise: number;
  lineCount: number;
  cases: number;
  createdAt: Date;
};

export async function listOrdersForRetailer(db: DB, retailerId: string, limit = 50): Promise<OrderSummary[]> {
  return db
    .select({
      id: orders.id,
      number: orders.number,
      status: orders.status,
      source: orders.source,
      totalPaise: orders.totalPaise,
      createdAt: orders.createdAt,
      lineCount: sql<number>`count(${orderLines.id})`.mapWith(Number),
      cases: sql<number>`coalesce(sum(${orderLines.cases}), 0)`.mapWith(Number),
    })
    .from(orders)
    .leftJoin(orderLines, eq(orderLines.orderId, orders.id))
    .where(eq(orders.retailerId, retailerId))
    .groupBy(orders.id)
    .orderBy(desc(orders.createdAt))
    .limit(limit);
}

/** Order with lines, or null if it does not exist OR the viewer may not see it (no existence leak). */
export async function getOrderForViewer(db: DB, viewer: Viewer, orderId: string) {
  const [row] = await db
    .select({ order: orders, retailer: { id: retailers.id, salesmanId: retailers.salesmanId, shopName: retailers.shopName, code: retailers.code } })
    .from(orders)
    .innerJoin(retailers, eq(retailers.id, orders.retailerId))
    .where(eq(orders.id, orderId));
  if (!row || !canAccessRetailer(viewer, row.retailer)) return null;

  const lines = await db
    .select({
      line: orderLines,
      sku: { id: skus.id, code: skus.code, name: skus.name, nameHi: skus.nameHi, imageKey: skus.imageKey, category: skus.category },
    })
    .from(orderLines)
    .innerJoin(skus, eq(skus.id, orderLines.skuId))
    .where(eq(orderLines.orderId, orderId))
    .orderBy(skus.name);

  return { ...row.order, retailer: row.retailer, lines: lines.map((l) => ({ ...l.line, sku: l.sku })) };
}
