import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db";
import {
  auditLog,
  captureLines,
  captures,
  inboundMessages,
  orderLines,
  orders,
  retailerAliases,
  retailers,
  skus,
  type OrderStatus,
} from "@/db/schema";
import type { Viewer } from "@/lib/auth/policy";
import { aliasPhrase, captureOrder, CircuitBreaker, MAX_MESSAGE_CHARS, type CaptureModel } from "@/lib/capture";

/**
 * One breaker per server process for automatic AI reads (see lib/capture/breaker.ts).
 * After 2 timeouts / 5xx within ~5 min, automatic reads use rules for 2 min.
 */
export const aiBreaker = new CircuitBreaker();
import { isDesk } from "./desk";
import { createOrder, withBusyRetry, type PlaceOrderResult } from "./orders";
import { cartSchema, priceCart } from "./pricing";

export const INBOX_FILTERS = ["todo", "new", "captured", "converted", "dismissed", "all"] as const;
export type InboxFilter = (typeof INBOX_FILTERS)[number];

export async function listInbox(db: DB, viewer: Viewer, filter: InboxFilter = "todo") {
  if (!isDesk(viewer)) return [];
  const where =
    filter === "all" ? undefined : filter === "todo" ? inArray(inboundMessages.status, ["new", "captured"]) : eq(inboundMessages.status, filter);
  return db
    .select({
      id: inboundMessages.id,
      body: inboundMessages.body,
      channel: inboundMessages.channel,
      status: inboundMessages.status,
      fromPhone: inboundMessages.fromPhone,
      receivedAt: inboundMessages.receivedAt,
      orderId: inboundMessages.orderId,
      retailerId: inboundMessages.retailerId,
      shopName: retailers.shopName,
      retailerCode: retailers.code,
    })
    .from(inboundMessages)
    .leftJoin(retailers, eq(retailers.id, inboundMessages.retailerId))
    .where(where)
    .orderBy(desc(inboundMessages.receivedAt))
    .limit(100);
}

export const manualMessageSchema = z.object({
  retailerId: z.string().min(1).max(64),
  body: z.string().trim().min(2).max(MAX_MESSAGE_CHARS),
});

/** The desk pastes a message received outside the (mocked) WhatsApp integration. */
export async function addManualMessage(db: DB, viewer: Viewer, raw: unknown, now = new Date()) {
  if (!isDesk(viewer)) return { ok: false as const, error: "FORBIDDEN" as const };
  const parsed = manualMessageSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: "INVALID_INPUT" as const };
  const [r] = await db.select({ id: retailers.id, phone: retailers.phone }).from(retailers).where(eq(retailers.id, parsed.data.retailerId));
  if (!r) return { ok: false as const, error: "INVALID_INPUT" as const };
  const [msg] = await db
    .insert(inboundMessages)
    .values({ retailerId: r.id, fromPhone: r.phone, channel: "manual", body: parsed.data.body, receivedAt: now })
    .returning({ id: inboundMessages.id });
  await db.insert(auditLog).values({ actorId: viewer.id, action: "message.added_manually", entity: "message", entityId: msg.id, createdAt: now });
  return { ok: true as const, messageId: msg.id };
}

/** What the capture engine may see: names and pack sizes. Never prices, stock or schemes. */
async function captureContext(db: DB, retailerId: string | null) {
  const catalogue = await db
    .select({ id: skus.id, code: skus.code, name: skus.name, nameHi: skus.nameHi, category: skus.category, packSize: skus.packSize })
    .from(skus)
    .where(eq(skus.active, true));
  if (!retailerId) return { catalogue, aliases: [], history: [] };

  const aliases = await db
    .select({ phrase: retailerAliases.phrase, skuId: retailerAliases.skuId, unit: retailerAliases.unit })
    .from(retailerAliases)
    .where(eq(retailerAliases.retailerId, retailerId));

  // "Maps items to SKUs using the retailer's past orders" (brief).
  const past = await db
    .select({ skuId: orderLines.skuId, cases: orderLines.cases })
    .from(orderLines)
    .innerJoin(orders, eq(orders.id, orderLines.orderId))
    .where(and(eq(orders.retailerId, retailerId), inArray(orders.status, ["placed", "approved", "exported", "credit_hold"])))
    .orderBy(desc(orders.createdAt));
  const history = new Map<string, { skuId: string; timesOrdered: number; lastCases: number }>();
  for (const p of past) {
    const h = history.get(p.skuId);
    if (h) h.timesOrdered++;
    else history.set(p.skuId, { skuId: p.skuId, timesOrdered: 1, lastCases: p.cases });
  }
  return {
    catalogue,
    aliases: aliases.map((a) => ({ ...a, unit: a.unit === "unknown" ? null : a.unit })),
    history: [...history.values()],
  };
}

export type RunCaptureResult = { ok: true; captureId: string; reused: boolean } | { ok: false; error: "FORBIDDEN" | "NOT_FOUND" | "CLOSED" };

/**
 * Run AI capture on a message and store the DRAFT lines. Reuses an existing draft
 * unless `force` (re-run, e.g. after linking an unknown sender to a shop).
 */
export async function runCapture(
  db: DB,
  viewer: Viewer,
  messageId: string,
  opts: {
    force?: boolean;
    model?: CaptureModel | null;
    now?: Date;
    /** Manual "Re-read with AI": call the model even while automatic reads are paused. */
    bypassPause?: boolean;
    breaker?: CircuitBreaker;
  } = {},
): Promise<RunCaptureResult> {
  if (!isDesk(viewer)) return { ok: false, error: "FORBIDDEN" };
  const [msg] = await db.select().from(inboundMessages).where(eq(inboundMessages.id, messageId));
  if (!msg) return { ok: false, error: "NOT_FOUND" };

  const [latest] = await db.select().from(captures).where(eq(captures.messageId, messageId)).orderBy(desc(captures.createdAt)).limit(1);
  if (latest?.status === "confirmed") return { ok: true, captureId: latest.id, reused: true };
  if (msg.status === "dismissed" || msg.status === "converted") return { ok: false, error: "CLOSED" };
  if (latest?.status === "draft" && !opts.force) return { ok: true, captureId: latest.id, reused: true };

  const ctx = await captureContext(db, msg.retailerId);
  const result = await captureOrder(
    { message: msg.body, ...ctx },
    { ...(opts.model === undefined ? {} : { model: opts.model }), breaker: opts.breaker ?? aiBreaker, bypassBreaker: opts.bypassPause === true },
  );
  const now = opts.now ?? new Date();

  const captureId = await db.transaction(async (tx) => {
    if (latest?.status === "draft") await tx.update(captures).set({ status: "discarded" }).where(eq(captures.id, latest.id));
    const [cap] = await tx
      .insert(captures)
      .values({ messageId, engine: result.engine, model: result.model, fallbackReason: result.fallbackReason, createdAt: now })
      .returning({ id: captures.id });
    if (result.lines.length) {
      await tx.insert(captureLines).values(
        result.lines.map((l) => ({
          captureId: cap.id,
          position: l.position,
          originalText: l.originalText,
          skuId: l.skuId,
          alt1SkuId: l.alternatives[0] ?? null,
          alt2SkuId: l.alternatives[1] ?? null,
          quantity: l.quantity,
          unit: l.unit,
          confidence: Math.round(l.confidence),
          matchedBy: l.matchedBy,
          issues: l.issues,
        })),
      );
    }
    await tx.update(inboundMessages).set({ status: "captured" }).where(eq(inboundMessages.id, messageId));
    await tx.insert(auditLog).values({
      actorId: viewer.id,
      action: "capture.created",
      entity: "message",
      entityId: messageId,
      data: {
        captureId: cap.id,
        engine: result.engine,
        model: result.model,
        fallbackReason: result.fallbackReason,
        lines: result.lines.length,
        // Metadata only: never the prompt, the model's answer or any key.
        ai: result.diagnostics,
      },
      createdAt: now,
    });
    return cap.id;
  });
  return { ok: true, captureId, reused: false };
}

/** Link a message from an unknown number to a shop (needed before an order can exist). */
export async function linkMessageToRetailer(db: DB, viewer: Viewer, messageId: string, retailerId: string, now = new Date()) {
  if (!isDesk(viewer)) return { ok: false as const, error: "FORBIDDEN" as const };
  const [r] = await db.select({ id: retailers.id }).from(retailers).where(eq(retailers.id, retailerId));
  if (!r) return { ok: false as const, error: "INVALID_INPUT" as const };
  const updated = await db
    .update(inboundMessages)
    .set({ retailerId })
    .where(and(eq(inboundMessages.id, messageId), inArray(inboundMessages.status, ["new", "captured"])))
    .returning({ id: inboundMessages.id });
  if (!updated.length) return { ok: false as const, error: "CLOSED" as const };
  await db.insert(auditLog).values({ actorId: viewer.id, action: "message.linked_retailer", entity: "message", entityId: messageId, data: { retailerId }, createdAt: now });
  return { ok: true as const };
}

export async function dismissMessage(db: DB, viewer: Viewer, messageId: string, reason: string, now = new Date()) {
  if (!isDesk(viewer)) return { ok: false as const, error: "FORBIDDEN" as const };
  const why = reason.trim().slice(0, 300);
  if (why.length < 3) return { ok: false as const, error: "INVALID_INPUT" as const };
  const done = await db.transaction(async (tx) => {
    const updated = await tx
      .update(inboundMessages)
      .set({ status: "dismissed" })
      .where(and(eq(inboundMessages.id, messageId), inArray(inboundMessages.status, ["new", "captured"])))
      .returning({ id: inboundMessages.id });
    if (!updated.length) return false;
    await tx.update(captures).set({ status: "discarded" }).where(and(eq(captures.messageId, messageId), eq(captures.status, "draft")));
    await tx.insert(auditLog).values({ actorId: viewer.id, action: "message.dismissed", entity: "message", entityId: messageId, data: { reason: why }, createdAt: now });
    return true;
  });
  return done ? { ok: true as const } : { ok: false as const, error: "CLOSED" as const };
}

export async function getReview(db: DB, viewer: Viewer, messageId: string) {
  if (!isDesk(viewer)) return null;
  const [msg] = await db
    .select({ message: inboundMessages, shopName: retailers.shopName, retailerCode: retailers.code, area: retailers.area })
    .from(inboundMessages)
    .leftJoin(retailers, eq(retailers.id, inboundMessages.retailerId))
    .where(eq(inboundMessages.id, messageId));
  if (!msg) return null;
  const [capture] = await db.select().from(captures).where(eq(captures.messageId, messageId)).orderBy(desc(captures.createdAt)).limit(1);
  const lines = capture ? await db.select().from(captureLines).where(eq(captureLines.captureId, capture.id)).orderBy(asc(captureLines.position)) : [];
  const catalogue = await db
    .select({ id: skus.id, code: skus.code, name: skus.name, category: skus.category, packSize: skus.packSize, imageKey: skus.imageKey })
    .from(skus)
    .where(eq(skus.active, true))
    .orderBy(skus.category, skus.name);
  let order: { id: string; number: string; status: OrderStatus } | null = null;
  if (capture?.orderId) {
    const [o] = await db.select({ id: orders.id, number: orders.number, status: orders.status }).from(orders).where(eq(orders.id, capture.orderId));
    order = o ?? null;
  }
  return { ...msg, capture: capture ?? null, lines, catalogue, order };
}

export const confirmSchema = z.object({
  captureId: z.string().min(1).max(64),
  lines: z
    .array(
      z.object({
        lineId: z.string().min(1).max(64),
        include: z.boolean(),
        skuId: z.string().min(1).max(64).nullable(),
        quantity: z.number().int().min(1).max(9999).nullable(),
        unit: z.enum(["case", "piece", "unknown"]),
      }),
    )
    .min(1)
    .max(100),
  expectedTotalPaise: z.number().int().min(0),
  idempotencyKey: z.uuid(),
  note: z.string().trim().max(300).optional(),
  /** The explicit "I have checked every line" confirmation. */
  confirmed: z.literal(true),
});

export type ConfirmResult =
  | PlaceOrderResult
  | { ok: false; error: "NOT_FOUND" | "CLOSED" | "NO_RETAILER" | "NO_LINES" }
  | { ok: false; error: "UNRESOLVED"; lineIds: string[] };

class CaptureRaceError extends Error {}

/** Resolve the desk's decisions into order lines, or the ids of lines still unresolved. */
function resolveLines(input: z.infer<typeof confirmSchema>, dbLines: (typeof captureLines.$inferSelect)[], activeSkuIds: Set<string>) {
  const byId = new Map(input.lines.map((l) => [l.lineId, l]));
  const unresolved: string[] = [];
  const decisions = dbLines.map((line) => {
    const d = byId.get(line.id);
    if (!d) {
      unresolved.push(line.id); // every AI line needs an explicit decision
      return null;
    }
    if (!d.include) return { line, d, included: false as const };
    // Orders are in cases (A2); a piece or unknown unit must be settled with the retailer first.
    if (!d.skuId || !activeSkuIds.has(d.skuId) || !d.quantity || d.unit !== "case") unresolved.push(line.id);
    return { line, d, included: true as const };
  });
  return { decisions, unresolved };
}

/**
 * Turn a reviewed capture into an order. Prices, schemes, GST, stock and credit
 * are recomputed by the pricing engine exactly as for a retailer checkout; the AI's
 * suggestion is only ever a starting point. Confirmation, line outcomes, aliases,
 * message status and audit rows commit atomically with the order.
 */
export async function confirmCapture(db: DB, viewer: Viewer, raw: unknown, now = new Date()): Promise<ConfirmResult> {
  if (!isDesk(viewer)) return { ok: false, error: "FORBIDDEN" };
  const parsed = confirmSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  const input = parsed.data;

  const [capture] = await db.select().from(captures).where(eq(captures.id, input.captureId));
  if (!capture) return { ok: false, error: "NOT_FOUND" };
  const existing = async () => {
    const [c] = await db.select({ orderId: captures.orderId }).from(captures).where(eq(captures.id, input.captureId));
    if (!c?.orderId) return null;
    const [o] = await db.select({ id: orders.id, number: orders.number, status: orders.status }).from(orders).where(eq(orders.id, c.orderId));
    return o ? ({ ok: true, orderId: o.id, number: o.number, status: o.status, duplicate: true } as const) : null;
  };
  if (capture.status === "confirmed") return (await existing()) ?? { ok: false, error: "CLOSED" };
  if (capture.status !== "draft") return { ok: false, error: "CLOSED" };

  const [msg] = await db.select().from(inboundMessages).where(eq(inboundMessages.id, capture.messageId));
  if (!msg?.retailerId) return { ok: false, error: "NO_RETAILER" };
  const retailerId = msg.retailerId;

  const dbLines = await db.select().from(captureLines).where(eq(captureLines.captureId, capture.id));
  const active = new Set((await db.select({ id: skus.id }).from(skus).where(eq(skus.active, true))).map((s) => s.id));
  const { decisions, unresolved } = resolveLines(input, dbLines, active);
  if (unresolved.length) return { ok: false, error: "UNRESOLVED", lineIds: unresolved };
  const included = decisions.filter((d): d is NonNullable<typeof d> & { included: true } => !!d?.included);
  if (!included.length) return { ok: false, error: "NO_LINES" };

  const cart = cartSchema.parse(included.map(({ d }) => ({ skuId: d.skuId!, cases: d.quantity! })));

  try {
    return await withBusyRetry(() =>
      createOrder(db, {
        retailerId,
        actorId: viewer.id,
        source: "capture",
        captureId: capture.id,
        now,
        input: { lines: cart, expectedTotalPaise: input.expectedTotalPaise, idempotencyKey: input.idempotencyKey, note: input.note },
        onCreated: async (tx, order) => {
          // Only one confirmation can win, even across two desk users.
          const won = await tx
            .update(captures)
            .set({ status: "confirmed", confirmedById: viewer.id, confirmedAt: now, orderId: order.id })
            .where(and(eq(captures.id, capture.id), eq(captures.status, "draft")))
            .returning({ id: captures.id });
          if (!won.length) throw new CaptureRaceError();

          const corrections: Record<string, unknown>[] = [];
          for (const item of decisions) {
            if (!item) continue;
            const { line, d } = item;
            const skuChanged = item.included && d.skuId !== line.skuId;
            const unitResolved = item.included && line.unit !== "case";
            const qtyChanged = item.included && d.quantity !== line.quantity;
            const corrected = skuChanged || unitResolved || qtyChanged;
            await tx
              .update(captureLines)
              .set({
                excluded: !item.included,
                corrected,
                finalSkuId: item.included ? d.skuId : null,
                finalQuantity: item.included ? d.quantity : null,
                finalUnit: item.included ? d.unit : null,
              })
              .where(eq(captureLines.id, line.id));
            if (corrected || !item.included) {
              corrections.push({ lineId: line.id, words: line.originalText, ai: { skuId: line.skuId, quantity: line.quantity, unit: line.unit }, desk: item.included ? { skuId: d.skuId, quantity: d.quantity, unit: d.unit } : "excluded" });
            }

            // Desk corrections become aliases for this retailer (brief). A new SKU or a
            // settled unit is learned; a changed quantity is not (it varies per order).
            const phrase = aliasPhrase(line.originalText);
            if ((skuChanged || unitResolved) && phrase) {
              await tx
                .insert(retailerAliases)
                .values({ retailerId, phrase, skuId: d.skuId!, unit: "case", createdById: viewer.id, createdAt: now })
                .onConflictDoUpdate({
                  target: [retailerAliases.retailerId, retailerAliases.phrase],
                  set: { skuId: d.skuId!, unit: "case", createdById: viewer.id, createdAt: now },
                });
              await tx.insert(auditLog).values({
                actorId: viewer.id,
                action: "alias.saved",
                entity: "retailer",
                entityId: retailerId,
                data: { phrase, skuId: d.skuId, fromSkuId: line.skuId, unit: "case", captureId: capture.id },
                createdAt: now,
              });
            }
          }

          await tx.update(inboundMessages).set({ status: "converted", orderId: order.id }).where(eq(inboundMessages.id, msg.id));
          await tx.insert(auditLog).values({
            actorId: viewer.id,
            action: "capture.confirmed",
            entity: "order",
            entityId: order.id,
            data: { captureId: capture.id, messageId: msg.id, engine: capture.engine, corrections },
            createdAt: now,
          });
        },
      }),
    );
  } catch (error) {
    if (error instanceof CaptureRaceError) return (await existing()) ?? { ok: false, error: "CLOSED" };
    throw error;
  }
}

/** Live server pricing for the review screen (desk may price for any retailer). */
export async function priceForDesk(db: DB, viewer: Viewer, retailerId: string, rawLines: unknown, asOf: string) {
  if (!isDesk(viewer)) return null;
  const parsed = cartSchema.safeParse(rawLines);
  if (!parsed.success) return null;
  return priceCart(db, retailerId, parsed.data, asOf);
}

