import type { DB } from "./index";
import * as s from "./schema";
import * as data from "./seed-data";
import { seedHistory } from "./seed-history";

/** Wipes and re-seeds master data. Safe to run repeatedly. */
export async function seed(db: DB, now = new Date()) {
  // Children first.
  for (const table of [
    s.tallyExports,
    s.auditLog,
    s.smsOutbox,
    s.otpCodes,
    s.rateLimits,
    s.retailerAliases,
    s.captureLines,
    s.captures,
    s.inboundMessages,
    s.orderLines,
    s.orders,
    s.schemes,
    s.stock,
    s.prices,
    s.skus,
    s.brands,
    s.users,
    s.retailers,
  ]) {
    await db.delete(table);
  }

  const brandIds = new Map<string, string>();
  for (const b of data.brands) {
    const [row] = await db.insert(s.brands).values({ name: b.name }).returning({ id: s.brands.id });
    brandIds.set(b.key, row.id);
  }

  const skuIds = new Map<string, string>();
  for (const k of data.skus) {
    const [row] = await db
      .insert(s.skus)
      .values({
        code: k.code,
        name: k.name,
        nameHi: k.nameHi,
        brandId: brandIds.get(k.brand)!,
        category: k.category,
        packSize: k.packSize,
        gstRateBp: k.gstRateBp,
        imageKey: k.imageKey,
      })
      .returning({ id: s.skus.id });
    skuIds.set(k.code, row.id);
    await db.insert(s.prices).values({ skuId: row.id, priceTier: "standard", pricePerPiecePaise: k.pricePerPiecePaise });
    await db.insert(s.stock).values({ skuId: row.id, cases: k.stockCases, updatedAt: now });
  }

  for (const sc of data.schemes) {
    const skuId = skuIds.get(sc.sku)!;
    await db.insert(s.schemes).values(
      sc.type === "FREE_GOODS"
        ? { skuId, type: sc.type, buyQty: sc.buyQty, freeQty: sc.freeQty, label: sc.label, validFrom: sc.validFrom, validTo: sc.validTo }
        : { skuId, type: sc.type, minQty: sc.minQty, percentBp: sc.percentBp, label: sc.label, validFrom: sc.validFrom, validTo: sc.validTo },
    );
  }

  const staffIds = new Map<string, string>();
  for (const st of data.staff) {
    const [row] = await db
      .insert(s.users)
      .values({ phone: st.phone, name: st.name, role: st.role })
      .returning({ id: s.users.id });
    staffIds.set(st.key, row.id);
  }

  const retailerIds = new Map<string, string>();
  const retailerUserIds = new Map<string, string>();
  for (const r of data.retailers) {
    const [row] = await db
      .insert(s.retailers)
      .values({
        code: r.code,
        shopName: r.shopName,
        ownerName: r.ownerName,
        area: r.area,
        phone: r.phone,
        salesmanId: staffIds.get(r.salesman)!,
        creditLimitPaise: r.creditLimitPaise,
        outstandingPaise: r.outstandingPaise,
      })
      .returning({ id: s.retailers.id });
    retailerIds.set(r.phone, row.id);
    const [u] = await db
      .insert(s.users)
      .values({ phone: r.phone, name: r.ownerName, role: "retailer", retailerId: row.id })
      .returning({ id: s.users.id });
    retailerUserIds.set(r.phone, u.id);
  }

  for (const m of data.messages) {
    await db.insert(s.inboundMessages).values({
      retailerId: retailerIds.get(m.from) ?? null,
      fromPhone: m.from,
      channel: "whatsapp",
      body: m.body,
      receivedAt: new Date(now.getTime() - m.minutesAgo * 60_000),
    });
  }

  const history = await seedHistory(db, { retailerIds, retailerUserIds, staffIds }, now);

  return { brandIds, skuIds, staffIds, retailerIds, retailerUserIds, history };
}
