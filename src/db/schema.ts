import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Conventions
 * - Money is integer paise. Percentages are integer basis points (1% = 100 bp).
 * - Quantities ordered are whole cases unless a column says otherwise.
 * - Timestamps are Unix milliseconds. Scheme validity uses ISO dates (YYYY-MM-DD, IST).
 */

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date());

export const ROLES = ["retailer", "desk", "salesman"] as const;
export type Role = (typeof ROLES)[number];

export const users = sqliteTable("users", {
  id: id(),
  phone: text("phone").notNull().unique(), // E.164 without "+", e.g. 919800000001
  name: text("name").notNull(),
  role: text("role", { enum: ROLES }).notNull(),
  retailerId: text("retailer_id").references(() => retailers.id),
  language: text("language", { enum: ["en", "hi"] }).notNull().default("en"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: createdAt(),
});

export const retailers = sqliteTable(
  "retailers",
  {
    id: id(),
    code: text("code").notNull().unique(), // e.g. RT-1042
    shopName: text("shop_name").notNull(),
    ownerName: text("owner_name").notNull(),
    area: text("area").notNull(),
    phone: text("phone").notNull(),
    salesmanId: text("salesman_id"),
    priceTier: text("price_tier").notNull().default("standard"),
    creditLimitPaise: integer("credit_limit_paise").notNull(),
    outstandingPaise: integer("outstanding_paise").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("retailers_salesman_idx").on(t.salesmanId)],
);

export const brands = sqliteTable("brands", {
  id: id(),
  name: text("name").notNull().unique(),
});

export const skus = sqliteTable("skus", {
  id: id(),
  code: text("code").notNull().unique(), // e.g. SKU-BS-075
  name: text("name").notNull(), // "Glucose biscuit 75 g, case of 96"
  nameHi: text("name_hi").notNull(),
  brandId: text("brand_id")
    .notNull()
    .references(() => brands.id),
  category: text("category").notNull(),
  packSize: integer("pack_size").notNull(), // pieces per case
  gstRateBp: integer("gst_rate_bp").notNull(), // placeholder rate, see assumption A6
  imageKey: text("image_key").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

/** Dealer price per piece, excluding GST (assumption A1), per price tier. */
export const prices = sqliteTable(
  "prices",
  {
    skuId: text("sku_id")
      .notNull()
      .references(() => skus.id),
    priceTier: text("price_tier").notNull(),
    pricePerPiecePaise: integer("price_per_piece_paise").notNull(),
  },
  (t) => [uniqueIndex("prices_sku_tier_uq").on(t.skuId, t.priceTier)],
);

export const stock = sqliteTable("stock", {
  skuId: text("sku_id")
    .primaryKey()
    .references(() => skus.id),
  cases: integer("cases").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const SCHEME_TYPES = ["FREE_GOODS", "SLAB_PERCENT"] as const;
export type SchemeType = (typeof SCHEME_TYPES)[number];

export const schemes = sqliteTable(
  "schemes",
  {
    id: id(),
    skuId: text("sku_id")
      .notNull()
      .references(() => skus.id),
    type: text("type", { enum: SCHEME_TYPES }).notNull(),
    buyQty: integer("buy_qty"), // FREE_GOODS: buy N cases …
    freeQty: integer("free_qty"), // … get M cases free
    minQty: integer("min_qty"), // SLAB_PERCENT: from N cases …
    percentBp: integer("percent_bp"), // … X bp off line value
    label: text("label").notNull(), // human text shown to retailers
    validFrom: text("valid_from").notNull(), // YYYY-MM-DD inclusive
    validTo: text("valid_to"), // YYYY-MM-DD inclusive, null = open-ended
    active: integer("active", { mode: "boolean" }).notNull().default(true),
  },
  (t) => [index("schemes_sku_idx").on(t.skuId)],
);

export const ORDER_STATUSES = ["placed", "credit_hold", "approved", "exported", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const ORDER_SOURCES = ["app", "capture", "desk"] as const;
export type OrderSource = (typeof ORDER_SOURCES)[number];

export const orders = sqliteTable(
  "orders",
  {
    id: id(),
    number: text("number").notNull().unique(), // e.g. SO-2611-0042
    retailerId: text("retailer_id")
      .notNull()
      .references(() => retailers.id),
    source: text("source", { enum: ORDER_SOURCES }).notNull(),
    status: text("status", { enum: ORDER_STATUSES }).notNull(),
    grossPaise: integer("gross_paise").notNull(),
    discountPaise: integer("discount_paise").notNull(),
    taxablePaise: integer("taxable_paise").notNull(),
    gstPaise: integer("gst_paise").notNull(),
    totalPaise: integer("total_paise").notNull(),
    captureId: text("capture_id"),
    /** Client-generated per checkout attempt; makes double-submits return the same order. */
    idempotencyKey: text("idempotency_key"),
    /** Value of open orders + outstanding at placement, for the desk's credit decision. */
    creditExposurePaise: integer("credit_exposure_paise"),
    note: text("note"),
    holdReason: text("hold_reason"),
    cancelReason: text("cancel_reason"),
    createdById: text("created_by_id")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("orders_retailer_idx").on(t.retailerId, t.createdAt),
    index("orders_status_idx").on(t.status),
    uniqueIndex("orders_idempotency_uq").on(t.retailerId, t.idempotencyKey),
  ],
);

export const orderLines = sqliteTable(
  "order_lines",
  {
    id: id(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    skuId: text("sku_id")
      .notNull()
      .references(() => skus.id),
    cases: integer("cases").notNull(),
    freeCases: integer("free_cases").notNull().default(0),
    packSize: integer("pack_size").notNull(),
    pricePerPiecePaise: integer("price_per_piece_paise").notNull(),
    grossPaise: integer("gross_paise").notNull(),
    discountPaise: integer("discount_paise").notNull(),
    gstRateBp: integer("gst_rate_bp").notNull(),
    gstPaise: integer("gst_paise").notNull(),
    totalPaise: integer("total_paise").notNull(),
    schemeId: text("scheme_id"),
    schemeNote: text("scheme_note"),
  },
  (t) => [index("order_lines_order_idx").on(t.orderId)],
);

export const MESSAGE_CHANNELS = ["whatsapp", "sms", "manual"] as const;
export const MESSAGE_STATUSES = ["new", "captured", "converted", "dismissed"] as const;

export const inboundMessages = sqliteTable(
  "inbound_messages",
  {
    id: id(),
    retailerId: text("retailer_id").references(() => retailers.id),
    fromPhone: text("from_phone").notNull(),
    channel: text("channel", { enum: MESSAGE_CHANNELS }).notNull(),
    body: text("body").notNull(),
    status: text("status", { enum: MESSAGE_STATUSES }).notNull().default("new"),
    receivedAt: integer("received_at", { mode: "timestamp_ms" }).notNull(),
    orderId: text("order_id"),
  },
  (t) => [index("inbound_status_idx").on(t.status, t.receivedAt)],
);

export const captures = sqliteTable("captures", {
  id: id(),
  messageId: text("message_id")
    .notNull()
    .references(() => inboundMessages.id),
  engine: text("engine", { enum: ["llm", "rules"] }).notNull(),
  model: text("model"),
  fallbackReason: text("fallback_reason"),
  status: text("status", { enum: ["draft", "confirmed", "discarded"] })
    .notNull()
    .default("draft"),
  /** Set when the desk confirms: who, when, and the order it became. */
  confirmedById: text("confirmed_by_id"),
  confirmedAt: integer("confirmed_at", { mode: "timestamp_ms" }),
  orderId: text("order_id"),
  createdAt: createdAt(),
});

export const UNITS = ["case", "piece", "unknown"] as const;

export const captureLines = sqliteTable(
  "capture_lines",
  {
    id: id(),
    captureId: text("capture_id")
      .notNull()
      .references(() => captures.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    originalText: text("original_text").notNull(),
    skuId: text("sku_id"),
    alt1SkuId: text("alt1_sku_id"),
    alt2SkuId: text("alt2_sku_id"),
    quantity: integer("quantity"),
    unit: text("unit", { enum: UNITS }).notNull(),
    confidence: integer("confidence").notNull(), // 0–100
    matchedBy: text("matched_by").notNull(), // alias | history | llm | fuzzy | none
    issues: text("issues", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
    // What the desk confirmed (the AI suggestion above is kept unchanged for audit).
    finalSkuId: text("final_sku_id"),
    finalQuantity: integer("final_quantity"),
    finalUnit: text("final_unit", { enum: UNITS }),
    excluded: integer("excluded", { mode: "boolean" }).notNull().default(false),
    corrected: integer("corrected", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [index("capture_lines_capture_idx").on(t.captureId)],
);

/** Desk corrections become retailer-specific aliases (brief: "desk corrections become aliases"). */
export const retailerAliases = sqliteTable(
  "retailer_aliases",
  {
    id: id(),
    retailerId: text("retailer_id")
      .notNull()
      .references(() => retailers.id),
    phrase: text("phrase").notNull(), // normalised words as written by the retailer
    skuId: text("sku_id")
      .notNull()
      .references(() => skus.id),
    unit: text("unit", { enum: UNITS }),
    createdById: text("created_by_id").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("aliases_retailer_phrase_uq").on(t.retailerId, t.phrase)],
);

export const otpCodes = sqliteTable(
  "otp_codes",
  {
    id: id(),
    phone: text("phone").notNull(),
    codeHash: text("code_hash").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    consumedAt: integer("consumed_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
  },
  (t) => [index("otp_phone_idx").on(t.phone, t.createdAt)],
);

/**
 * Fixed-window counters for abuse limits (per-IP and global OTP limits). One row
 * per key, updated by a single atomic upsert (src/lib/auth/rate-limit.ts). Keys
 * never contain a raw IP address, only a keyed hash of it.
 */
export const rateLimits = sqliteTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: integer("window_start").notNull(), // Unix ms, start of the current window
  count: integer("count").notNull(),
});

/** Mocked SMS/WhatsApp gateway: everything "sent" is written here (assumption A10). */
export const smsOutbox = sqliteTable("sms_outbox", {
  id: id(),
  toPhone: text("to_phone").notNull(),
  body: text("body").notNull(),
  purpose: text("purpose").notNull(),
  createdAt: createdAt(),
});

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: id(),
    actorId: text("actor_id"),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id").notNull(),
    data: text("data", { mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index("audit_entity_idx").on(t.entity, t.entityId)],
);

export const tallyExports = sqliteTable("tally_exports", {
  id: id(),
  fileName: text("file_name").notNull(),
  format: text("format", { enum: ["xml", "csv"] }).notNull(),
  orderIds: text("order_ids", { mode: "json" }).$type<string[]>().notNull(),
  createdById: text("created_by_id")
    .notNull()
    .references(() => users.id),
  createdAt: createdAt(),
});
