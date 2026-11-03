import { and, desc, eq, gte, inArray, like, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db";
import { isBusy, withBusyRetry } from "@/db/busy";
import { auditLog, orderLines, orders, retailers, schemes, skus, stock, type OrderSource, type OrderStatus } from "@/db/schema";
import { canAccessRetailer, type Viewer } from "@/lib/auth/policy";
import { formatPaise } from "@/lib/money";
import { isoDateIST } from "@/lib/pricing";
import { loadCredit } from "./catalogue";
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
 * - over the credit limit → status credit_hold for the desk, never auto-rejected (A7);
 *   the credit check is repeated inside the write transaction (see createOrder).
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
  const retailerId = viewer.retailerId;
  const now = opts.now ?? new Date();
  return withBusyRetry(() =>
    createOrder(db, { retailerId, actorId: viewer.id, source: opts.source ?? "app", input: parsed.data, now }),
  );
}

/**
 * SQLite allows one writer at a time; a simultaneous double tap can hit a locked
 * database. withBusyRetry (src/db/busy.ts) retries with backoff: the next attempt's
 * idempotency check then finds the first order and returns it, so the user never
 * sees an error. Re-exported here for the desk, capture and Tally services.
 */
export { withBusyRetry };

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

export type CreateOrderArgs = {
  retailerId: string; // decided by the caller's access check, never by the client
  actorId: string;
  source: OrderSource;
  input: PlaceOrderInput;
  now: Date;
  captureId?: string;
  /** Extra writes that must commit or roll back together with the order (e.g. capture confirmation). */
  onCreated?: (tx: Tx, order: { id: string; number: string }) => Promise<void>;
};

/**
 * The single path that creates an order, shared by retailer checkout and desk
 * capture confirmation. Callers must have authorised `actorId` for `retailerId`.
 */
export async function createOrder(db: DB, args: CreateOrderArgs): Promise<PlaceOrderResult> {
  const { retailerId, input, now, source } = args;
  const previous = await existingOrder(db, retailerId, input.idempotencyKey);
  if (previous) return { ok: true, orderId: previous.id, number: previous.number, status: previous.status, duplicate: true };

  const pricing = await priceCart(db, retailerId, input.lines, isoDateIST(now));
  if (!pricing) return { ok: false, error: "FORBIDDEN" };
  if (!pricing.orderable) return { ok: false, error: "NOT_ORDERABLE", pricing };
  if (pricing.totals.totalPaise !== input.expectedTotalPaise) return { ok: false, error: "PRICE_CHANGED", pricing };

  try {
    // libSQL write transactions start with BEGIN IMMEDIATE, so everything below runs
    // with the database write lock held and concurrent orders are serialised.
    const created = await db.transaction(async (tx) => {
      // Re-check credit under the lock. The check in priceCart ran before the lock, so a
      // simultaneous order from the same shop may have been committed since; same rule
      // (A7/A11): outstanding + open orders + this order over the limit → credit hold.
      const credit = await loadCredit(tx, retailerId);
      if (!credit) throw new Error("retailer disappeared while placing an order");
      const exceedsByPaise = credit.exposurePaise + pricing.totals.totalPaise - credit.limitPaise;
      const status: OrderStatus = exceedsByPaise > 0 ? "credit_hold" : "placed";
      const holdReason =
        status === "credit_hold" ? `Over credit limit by ${formatPaise(exceedsByPaise)} (outstanding + open orders + this order)` : null;

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
          creditExposurePaise: credit.exposurePaise,
          note: input.note || null,
          holdReason,
          captureId: args.captureId ?? null,
          createdById: args.actorId,
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
        actorId: args.actorId,
        action: status === "credit_hold" ? "order.placed_on_credit_hold" : "order.placed",
        entity: "order",
        entityId: order.id,
        data: { number, source, totalPaise: pricing.totals.totalPaise, lines: pricing.lines.length },
        createdAt: now,
      });
      if (args.onCreated) await args.onCreated(tx, order);
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

export type OrderItemPreview = { skuId: string; name: string; nameHi: string; cases: number };

/**
 * Items per order for the retailer's order list (read-only). Scoped to the
 * retailer, so ids from another shop return nothing.
 */
export async function orderItemPreviews(db: DB, retailerId: string, orderIds: string[]): Promise<Map<string, OrderItemPreview[]>> {
  const out = new Map<string, OrderItemPreview[]>();
  if (orderIds.length === 0) return out;
  const rows = await db
    .select({ orderId: orderLines.orderId, skuId: orderLines.skuId, cases: orderLines.cases, name: skus.name, nameHi: skus.nameHi })
    .from(orderLines)
    .innerJoin(orders, eq(orders.id, orderLines.orderId))
    .innerJoin(skus, eq(skus.id, orderLines.skuId))
    .where(and(eq(orders.retailerId, retailerId), inArray(orderLines.orderId, orderIds)))
    .orderBy(desc(orderLines.cases), skus.name);
  for (const r of rows) out.set(r.orderId, [...(out.get(r.orderId) ?? []), { skuId: r.skuId, name: r.name, nameHi: r.nameHi, cases: r.cases }]);
  return out;
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
      // The rule as it was applied, so the scheme can be described in either language.
      scheme: { type: schemes.type, buyQty: schemes.buyQty, freeQty: schemes.freeQty, minQty: schemes.minQty, percentBp: schemes.percentBp },
    })
    .from(orderLines)
    .innerJoin(skus, eq(skus.id, orderLines.skuId))
    .leftJoin(schemes, eq(schemes.id, orderLines.schemeId))
    .where(eq(orderLines.orderId, orderId))
    .orderBy(skus.name);

  return {
    ...row.order,
    retailer: row.retailer,
    lines: lines.map((l) => ({ ...l.line, sku: l.sku, scheme: l.scheme?.type ? schemeRule(l.scheme) : null })),
  };
}

type SchemeRow = { type: "FREE_GOODS" | "SLAB_PERCENT" | null; buyQty: number | null; freeQty: number | null; minQty: number | null; percentBp: number | null };

function schemeRule(r: SchemeRow) {
  return r.type === "FREE_GOODS"
    ? ({ type: "FREE_GOODS", buyQty: r.buyQty ?? 0, freeQty: r.freeQty ?? 0 } as const)
    : ({ type: "SLAB_PERCENT", minQty: r.minQty ?? 0, percentBp: r.percentBp ?? 0 } as const);
}
