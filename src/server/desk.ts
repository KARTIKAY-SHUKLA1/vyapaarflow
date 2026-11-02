import { and, count, desc, eq, gte, inArray, like, lt, max, or, sql, sum } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db";
import { auditLog, inboundMessages, orderLines, orders, retailers, stock, users, type OrderSource, type OrderStatus } from "@/db/schema";
import type { Viewer } from "@/lib/auth/policy";
import { withBusyRetry } from "./orders";

/** Every desk function checks the role itself; UI hiding is never the control. */
export function isDesk(viewer: Viewer | null): viewer is Viewer {
  return viewer?.role === "desk";
}

const DAY = 86_400_000;
export const DORMANT_DAYS = 14;

export async function deskOverview(db: DB, viewer: Viewer, now = new Date()) {
  if (!isDesk(viewer)) return null;
  const startOfDayIST = new Date(Math.floor((now.getTime() + 19_800_000) / DAY) * DAY - 19_800_000);

  const [byStatus, [inbox], [today], dormant] = await Promise.all([
    db.select({ status: orders.status, n: count(), total: sum(orders.totalPaise) }).from(orders).groupBy(orders.status),
    db.select({ n: count() }).from(inboundMessages).where(inArray(inboundMessages.status, ["new", "captured"])),
    db
      .select({ n: count(), total: sum(orders.totalPaise) })
      .from(orders)
      .where(and(gte(orders.createdAt, startOfDayIST), sql`${orders.status} != 'cancelled'`)),
    dormantRetailers(db, viewer, now),
  ]);
  const status = Object.fromEntries(byStatus.map((r) => [r.status, { n: r.n, total: Number(r.total ?? 0) }])) as Partial<
    Record<OrderStatus, { n: number; total: number }>
  >;
  return {
    placed: status.placed?.n ?? 0,
    creditHold: status.credit_hold?.n ?? 0,
    creditHoldValue: status.credit_hold?.total ?? 0,
    approved: status.approved?.n ?? 0,
    approvedValue: status.approved?.total ?? 0,
    inbox: inbox.n,
    todayOrders: today.n,
    todayValue: Number(today.total ?? 0),
    dormant,
  };
}

/** Brief must-have: retailers with no order in 14 days (cancelled orders don't count). */
export async function dormantRetailers(db: DB, viewer: Viewer, now = new Date(), days = DORMANT_DAYS) {
  if (!isDesk(viewer)) return [];
  const rows = await db
    .select({
      id: retailers.id,
      code: retailers.code,
      shopName: retailers.shopName,
      area: retailers.area,
      phone: retailers.phone,
      lastOrderAt: max(orders.createdAt),
    })
    .from(retailers)
    .leftJoin(orders, and(eq(orders.retailerId, retailers.id), sql`${orders.status} != 'cancelled'`))
    .groupBy(retailers.id);
  const cutoff = now.getTime() - days * DAY;
  return rows
    .map((r) => ({ ...r, lastOrderAt: r.lastOrderAt ? new Date(r.lastOrderAt) : null }))
    .filter((r) => !r.lastOrderAt || r.lastOrderAt.getTime() < cutoff)
    .map((r) => ({ ...r, daysSince: r.lastOrderAt ? Math.floor((now.getTime() - r.lastOrderAt.getTime()) / DAY) : null }))
    .sort((a, b) => (b.daysSince ?? 9999) - (a.daysSince ?? 9999));
}

export const QUEUE_FILTERS = ["open", "placed", "credit_hold", "approved", "exported", "cancelled", "all"] as const;
export type QueueFilter = (typeof QUEUE_FILTERS)[number];

export async function listDeskOrders(
  db: DB,
  viewer: Viewer,
  opts: { filter?: QueueFilter; q?: string; source?: OrderSource; limit?: number; before?: Date } = {},
) {
  if (!isDesk(viewer)) return [];
  const filter = opts.filter ?? "open";
  const statusWhere =
    filter === "all" ? undefined : filter === "open" ? inArray(orders.status, ["placed", "credit_hold", "approved"]) : eq(orders.status, filter);
  const q = opts.q?.trim().slice(0, 60);
  const search = q ? or(like(orders.number, `%${q}%`), like(retailers.shopName, `%${q}%`), like(retailers.code, `%${q}%`)) : undefined;

  return db
    .select({
      id: orders.id,
      number: orders.number,
      status: orders.status,
      source: orders.source,
      totalPaise: orders.totalPaise,
      createdAt: orders.createdAt,
      holdReason: orders.holdReason,
      shopName: retailers.shopName,
      retailerCode: retailers.code,
      area: retailers.area,
      lineCount: sql<number>`count(${orderLines.id})`.mapWith(Number),
      cases: sql<number>`coalesce(sum(${orderLines.cases}), 0)`.mapWith(Number),
    })
    .from(orders)
    .innerJoin(retailers, eq(retailers.id, orders.retailerId))
    .leftJoin(orderLines, eq(orderLines.orderId, orders.id))
    .where(and(statusWhere, search, opts.source ? eq(orders.source, opts.source) : undefined, opts.before ? lt(orders.createdAt, opts.before) : undefined))
    .groupBy(orders.id)
    .orderBy(desc(orders.createdAt))
    .limit(opts.limit ?? 100);
}

export async function orderAudit(db: DB, viewer: Viewer, orderId: string) {
  if (!isDesk(viewer)) return [];
  return db
    .select({ id: auditLog.id, action: auditLog.action, data: auditLog.data, at: auditLog.createdAt, actor: users.name })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorId))
    .where(and(eq(auditLog.entity, "order"), eq(auditLog.entityId, orderId)))
    .orderBy(desc(auditLog.createdAt));
}

export const transitionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), orderId: z.string().min(1).max(64) }),
  z.object({ action: z.literal("release"), orderId: z.string().min(1).max(64), reason: z.string().trim().min(3).max(300) }),
  z.object({ action: z.literal("cancel"), orderId: z.string().min(1).max(64), reason: z.string().trim().min(3).max(300) }),
]);

/** Allowed moves. Exported and cancelled orders are final here (changes happen in Tally). */
const FROM: Record<"approve" | "release" | "cancel", OrderStatus[]> = {
  approve: ["placed"],
  release: ["credit_hold"],
  cancel: ["placed", "credit_hold", "approved"],
};

export type TransitionResult =
  | { ok: true; status: OrderStatus }
  | { ok: false; error: "FORBIDDEN" | "INVALID_INPUT" | "NOT_FOUND" | "CONFLICT"; current?: OrderStatus };

/**
 * Desk status changes. The update is conditional on the current status, so two
 * desk users acting on the same order can't both succeed (CONFLICT for the second).
 * Cancelling returns reserved stock (incl. free cases) in the same transaction (A12).
 */
export async function transitionOrder(db: DB, viewer: Viewer, raw: unknown, now = new Date()): Promise<TransitionResult> {
  if (!isDesk(viewer)) return { ok: false, error: "FORBIDDEN" };
  const parsed = transitionSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  const input = parsed.data;
  const next: OrderStatus = input.action === "cancel" ? "cancelled" : "approved";

  return withBusyRetry(async () => {
    const [current] = await db.select({ status: orders.status }).from(orders).where(eq(orders.id, input.orderId));
    if (!current) return { ok: false, error: "NOT_FOUND" } as const;

    const done = await db.transaction(async (tx) => {
      const updated = await tx
        .update(orders)
        .set({
          status: next,
          updatedAt: now,
          ...(input.action === "cancel" ? { cancelReason: input.reason } : {}),
        })
        .where(and(eq(orders.id, input.orderId), inArray(orders.status, FROM[input.action])))
        .returning({ id: orders.id });
      if (updated.length === 0) return false;

      if (input.action === "cancel") {
        const lines = await tx.select({ skuId: orderLines.skuId, cases: orderLines.cases, free: orderLines.freeCases }).from(orderLines).where(eq(orderLines.orderId, input.orderId));
        for (const l of lines) {
          await tx.update(stock).set({ cases: sql`${stock.cases} + ${l.cases + l.free}`, updatedAt: now }).where(eq(stock.skuId, l.skuId));
        }
      }
      await tx.insert(auditLog).values({
        actorId: viewer.id,
        action: input.action === "approve" ? "order.approved" : input.action === "release" ? "order.credit_released" : "order.cancelled",
        entity: "order",
        entityId: input.orderId,
        data: { from: current.status, to: next, ...("reason" in input ? { reason: input.reason } : {}) },
        createdAt: now,
      });
      return true;
    });

    if (!done) {
      const [again] = await db.select({ status: orders.status }).from(orders).where(eq(orders.id, input.orderId));
      return { ok: false, error: "CONFLICT", current: again?.status } as const;
    }
    return { ok: true, status: next } as const;
  });
}
