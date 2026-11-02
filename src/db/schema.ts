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
    note: text("note"),
    holdReason: text("hold_reason"),
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
