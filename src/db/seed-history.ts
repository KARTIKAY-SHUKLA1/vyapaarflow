import { priceOrder } from "@/lib/pricing";
import { isoDateIST } from "@/lib/pricing";
import { loadCatalogue } from "@/server/catalogue";
import type { DB } from "./index";
import * as s from "./schema";
import * as data from "./seed-data";

/** Small deterministic PRNG so every reseed produces the same history. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY = 86_400_000;
const HISTORY_DAYS = 60;

type Draft = {
  retailerCode: string;
  at: Date;
  lines: { skuId: string; cases: number }[];
  source: "app" | "desk";
};

/**
 * ~60 days of order history per retailer, priced by the SAME engine as live
 * orders (with the scheme rules in force on each order's date), so seeded
 * totals always match a live recalculation. History is priced against
 * unlimited historical stock: today's stock snapshot says nothing about stock
 * on past dates, and seeding must not consume today's stock.
 */
export async function seedHistory(
  db: DB,
  ids: { retailerIds: Map<string, string>; retailerUserIds: Map<string, string>; staffIds: Map<string, string> },
  now: Date,
) {
  const rand = mulberry32(20261102);
  const pick = <T,>(arr: readonly T[]) => arr[Math.floor(rand() * arr.length)];
  const catalogue = await loadCatalogue(db, "standard", isoDateIST(now));
  const byCode = new Map(catalogue.map((c) => [c.code, c]));

  const drafts: Draft[] = [];
  data.retailers.forEach((r, i) => {
    const favourites = (data.favouriteSkus[r.code] ?? catalogue.slice(i % 7, (i % 7) + 6).map((c) => c.code))
      .map((code) => byCode.get(code))
      .filter((c): c is NonNullable<typeof c> => Boolean(c));

    // Most recent order exactly `daysSinceLastOrder` ago, earlier ones spaced by the shop's rhythm.
    const gap = r.ordersPerWeek > 0 ? 7 / r.ordersPerWeek : 15;
    for (let age = r.daysSinceLastOrder; age <= HISTORY_DAYS; age += gap * (0.75 + rand() * 0.5)) {
      const day = new Date(now.getTime() - Math.round(age) * DAY);
      const at = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 3 + Math.floor(rand() * 11), Math.floor(rand() * 60)));
      if (at > now) at.setTime(now.getTime() - 3_600_000);
      const count = 2 + Math.floor(rand() * Math.min(4, favourites.length - 1));
      const chosen = [...favourites].sort(() => rand() - 0.5).slice(0, count);
      drafts.push({
        retailerCode: r.code,
        at,
        source: rand() < 0.2 ? "desk" : "app",
        lines: chosen.map((c) => ({
          skuId: c.id,
          // Occasionally round quantities that hit a scheme (10, 20 cases).
          cases: c.scheme?.type === "FREE_GOODS" && rand() < 0.4 ? pick([10, 20]) : 1 + Math.floor(rand() * 8),
        })),
      });
      if (r.ordersPerWeek === 0) break;
    }
  });

  drafts.sort((a, b) => a.at.getTime() - b.at.getTime());

  const openByRetailer = new Map<string, number>();
  const monthSeq = new Map<string, number>();
  const orderRows: (typeof s.orders.$inferInsert)[] = [];
  const lineRows: (typeof s.orderLines.$inferInsert)[] = [];

  for (const d of drafts) {
    const retailer = data.retailers.find((r) => r.code === d.retailerCode)!;
    const retailerId = ids.retailerIds.get(retailer.phone)!;
    const ageDays = (now.getTime() - d.at.getTime()) / DAY;
    const open = openByRetailer.get(retailerId) ?? 0;

    const priced = priceOrder({
      asOf: isoDateIST(d.at),
      credit: { limitPaise: retailer.creditLimitPaise, outstandingPaise: retailer.outstandingPaise + open },
      lines: d.lines.map((l) => {
        const c = catalogue.find((x) => x.id === l.skuId)!;
        return { skuId: c.id, cases: l.cases, packSize: c.packSize, pricePerPiecePaise: c.pricePerPiecePaise, gstRateBp: c.gstRateBp, stockCases: 9999, schemes: c.schemes };
      }),
    });

    // Older orders are invoiced in Tally; recent ones are still open on the desk.
    let status: s.OrderStatus = ageDays > 3 ? "exported" : ageDays > 1.5 ? "approved" : "placed";
    if (status !== "exported" && priced.credit.wouldExceed) status = "credit_hold";
    if (status !== "exported") openByRetailer.set(retailerId, open + priced.totals.totalPaise);

    const month = isoDateIST(d.at).slice(2, 7).replace("-", "");
    const seq = (monthSeq.get(month) ?? 0) + 1;
    monthSeq.set(month, seq);
    const orderId = crypto.randomUUID();

    orderRows.push({
      id: orderId,
      number: `SO-${month}-${String(seq).padStart(4, "0")}`,
      retailerId,
      source: d.source,
      status,
      grossPaise: priced.totals.grossPaise,
      discountPaise: priced.totals.discountPaise,
      taxablePaise: priced.totals.taxablePaise,
      gstPaise: priced.totals.gstPaise,
      totalPaise: priced.totals.totalPaise,
      creditExposurePaise: retailer.outstandingPaise + open,
      holdReason: status === "credit_hold" ? "Over credit limit (outstanding + open orders + this order)" : null,
      createdById: d.source === "desk" ? ids.staffIds.get("D1")! : ids.retailerUserIds.get(retailer.phone)!,
      createdAt: d.at,
      updatedAt: d.at,
    });
    for (const pl of priced.lines) {
      const c = catalogue.find((x) => x.id === pl.skuId)!;
      lineRows.push({
        orderId,
        skuId: pl.skuId,
        cases: pl.cases,
        freeCases: pl.freeCases,
        packSize: c.packSize,
        pricePerPiecePaise: c.pricePerPiecePaise,
        grossPaise: pl.grossPaise,
        discountPaise: pl.discountPaise,
        gstRateBp: pl.gstRateBp,
        gstPaise: pl.gstPaise,
        totalPaise: pl.totalPaise,
        schemeId: pl.appliedScheme?.id ?? null,
        schemeNote: pl.appliedScheme?.label ?? null,
      });
    }
  }

  for (let i = 0; i < orderRows.length; i += 100) await db.insert(s.orders).values(orderRows.slice(i, i + 100));
  for (let i = 0; i < lineRows.length; i += 100) await db.insert(s.orderLines).values(lineRows.slice(i, i + 100));
  return { orders: orderRows.length, lines: lineRows.length };
}
