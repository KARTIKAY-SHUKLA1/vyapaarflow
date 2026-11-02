/**
 * Seed data. Everything here is FICTIONAL (assumption A9): brands, shops, people
 * and phone numbers are invented. The three SKUs and the raw order message from
 * the Problem 5 brief are reproduced exactly.
 *
 * Prices are dealer price per piece in paise, excluding GST (assumption A1).
 * GST rates are placeholders to be confirmed by the client's accountant (A6).
 */

export const SEED_TODAY = "2026-11-02"; // reference date for seeded history and schemes

export const brands = [
  { key: "narmada", name: "Narmada Foods" }, // biscuits, rusk
  { key: "rewa", name: "Rewa Snacks" }, // namkeen, noodles
  { key: "ujla", name: "Ujla Home Care" }, // detergent, dishwash, soap
  { key: "kesari", name: "Kesari Tea Co." }, // tea
] as const;

export type BrandKey = (typeof brands)[number]["key"];

export type SeedSku = {
  code: string;
  name: string;
  nameHi: string;
  brand: BrandKey;
  category: "Biscuits" | "Snacks" | "Detergent" | "Dishwash" | "Soap" | "Tea";
  packSize: number;
  pricePerPiecePaise: number;
  gstRateBp: number;
  stockCases: number;
  imageKey: string;
};

export const skus: SeedSku[] = [
  // ── From the brief (exact codes, names, prices, stock) ──
  { code: "SKU-BS-075", name: "Glucose biscuit 75 g, case of 96", nameHi: "ग्लूकोज़ बिस्कुट 75 ग्रा, 96 का केस", brand: "narmada", category: "Biscuits", packSize: 96, pricePerPiecePaise: 810, gstRateBp: 500, stockCases: 340, imageKey: "biscuit" },
  { code: "SKU-DT-1KG", name: "Detergent powder 1 kg, case of 20", nameHi: "डिटर्जेंट पाउडर 1 कि.ग्रा, 20 का केस", brand: "ujla", category: "Detergent", packSize: 20, pricePerPiecePaise: 10150, gstRateBp: 1800, stockCases: 85, imageKey: "detergent" },
  { code: "SKU-TE-250", name: "Tea leaf 250 g, case of 40", nameHi: "चाय पत्ती 250 ग्रा, 40 का केस", brand: "kesari", category: "Tea", packSize: 40, pricePerPiecePaise: 11800, gstRateBp: 500, stockCases: 0, imageKey: "tea" },

  // ── Expanded fictional catalogue (near-neighbours make AI alternatives meaningful) ──
  { code: "SKU-BS-200", name: "Glucose biscuit 200 g, case of 48", nameHi: "ग्लूकोज़ बिस्कुट 200 ग्रा, 48 का केस", brand: "narmada", category: "Biscuits", packSize: 48, pricePerPiecePaise: 2050, gstRateBp: 500, stockCases: 120, imageKey: "biscuit" },
  { code: "SKU-BC-075", name: "Cream biscuit 75 g, case of 72", nameHi: "क्रीम बिस्कुट 75 ग्रा, 72 का केस", brand: "narmada", category: "Biscuits", packSize: 72, pricePerPiecePaise: 1350, gstRateBp: 500, stockCases: 64, imageKey: "biscuit-cream" },
  { code: "SKU-MR-100", name: "Marie biscuit 100 g, case of 60", nameHi: "मैरी बिस्कुट 100 ग्रा, 60 का केस", brand: "narmada", category: "Biscuits", packSize: 60, pricePerPiecePaise: 1520, gstRateBp: 500, stockCases: 90, imageKey: "biscuit" },
  { code: "SKU-RK-200", name: "Milk rusk 200 g, case of 36", nameHi: "मिल्क रस्क 200 ग्रा, 36 का केस", brand: "narmada", category: "Biscuits", packSize: 36, pricePerPiecePaise: 3200, gstRateBp: 500, stockCases: 42, imageKey: "rusk" },
  { code: "SKU-NM-150", name: "Aloo bhujia 150 g, case of 50", nameHi: "आलू भुजिया 150 ग्रा, 50 का केस", brand: "rewa", category: "Snacks", packSize: 50, pricePerPiecePaise: 3150, gstRateBp: 500, stockCases: 75, imageKey: "namkeen" },
  { code: "SKU-NM-400", name: "Aloo bhujia 400 g, case of 24", nameHi: "आलू भुजिया 400 ग्रा, 24 का केस", brand: "rewa", category: "Snacks", packSize: 24, pricePerPiecePaise: 8200, gstRateBp: 500, stockCases: 30, imageKey: "namkeen" },
  { code: "SKU-MX-200", name: "Khatta meetha mixture 200 g, case of 40", nameHi: "खट्टा मीठा मिक्सचर 200 ग्रा, 40 का केस", brand: "rewa", category: "Snacks", packSize: 40, pricePerPiecePaise: 4100, gstRateBp: 500, stockCases: 8, imageKey: "namkeen" },
  { code: "SKU-ND-070", name: "Masala noodles 70 g, case of 96", nameHi: "मसाला नूडल्स 70 ग्रा, 96 का केस", brand: "rewa", category: "Snacks", packSize: 96, pricePerPiecePaise: 1180, gstRateBp: 500, stockCases: 150, imageKey: "noodles" },
  { code: "SKU-DT-500", name: "Detergent powder 500 g, case of 40", nameHi: "डिटर्जेंट पाउडर 500 ग्रा, 40 का केस", brand: "ujla", category: "Detergent", packSize: 40, pricePerPiecePaise: 5250, gstRateBp: 1800, stockCases: 110, imageKey: "detergent" },
  { code: "SKU-DT-4KG", name: "Detergent powder 4 kg, case of 5", nameHi: "डिटर्जेंट पाउडर 4 कि.ग्रा, 5 का केस", brand: "ujla", category: "Detergent", packSize: 5, pricePerPiecePaise: 38500, gstRateBp: 1800, stockCases: 18, imageKey: "detergent" },
  { code: "SKU-DB-250", name: "Detergent bar 250 g, case of 60", nameHi: "डिटर्जेंट साबुन 250 ग्रा, 60 का केस", brand: "ujla", category: "Detergent", packSize: 60, pricePerPiecePaise: 1900, gstRateBp: 1800, stockCases: 95, imageKey: "bar" },
  { code: "SKU-DW-500", name: "Dishwash gel 500 ml, case of 24", nameHi: "डिशवॉश जेल 500 मि.ली, 24 का केस", brand: "ujla", category: "Dishwash", packSize: 24, pricePerPiecePaise: 9200, gstRateBp: 1800, stockCases: 36, imageKey: "dishwash" },
  { code: "SKU-DW-BAR", name: "Dishwash bar 200 g, case of 60", nameHi: "बर्तन साबुन 200 ग्रा, 60 का केस", brand: "ujla", category: "Dishwash", packSize: 60, pricePerPiecePaise: 1700, gstRateBp: 1800, stockCases: 0, imageKey: "bar" },
  { code: "SKU-SP-100", name: "Neem bath soap 100 g, case of 72", nameHi: "नीम साबुन 100 ग्रा, 72 का केस", brand: "ujla", category: "Soap", packSize: 72, pricePerPiecePaise: 2600, gstRateBp: 1800, stockCases: 58, imageKey: "soap" },
  { code: "SKU-TE-100", name: "Tea leaf 100 g, case of 100", nameHi: "चाय पत्ती 100 ग्रा, 100 का केस", brand: "kesari", category: "Tea", packSize: 100, pricePerPiecePaise: 4900, gstRateBp: 500, stockCases: 44, imageKey: "tea" },
  { code: "SKU-TE-500", name: "Tea leaf 500 g, case of 24", nameHi: "चाय पत्ती 500 ग्रा, 24 का केस", brand: "kesari", category: "Tea", packSize: 24, pricePerPiecePaise: 22800, gstRateBp: 500, stockCases: 26, imageKey: "tea" },
  { code: "SKU-TD-250", name: "Tea dust 250 g, case of 40", nameHi: "चाय डस्ट 250 ग्रा, 40 का केस", brand: "kesari", category: "Tea", packSize: 40, pricePerPiecePaise: 10600, gstRateBp: 500, stockCases: 52, imageKey: "tea" },
];

export type SeedScheme =
  | { sku: string; type: "FREE_GOODS"; buyQty: number; freeQty: number; label: string; validFrom: string; validTo: string | null }
  | { sku: string; type: "SLAB_PERCENT"; minQty: number; percentBp: number; label: string; validFrom: string; validTo: string | null };

export const schemes: SeedScheme[] = [
  // From the brief
  { sku: "SKU-BS-075", type: "FREE_GOODS", buyQty: 10, freeQty: 1, label: "Buy 10 cases get 1 free", validFrom: "2026-10-01", validTo: "2026-12-31" },
  { sku: "SKU-DT-1KG", type: "SLAB_PERCENT", minQty: 5, percentBp: 300, label: "3% off 5 or more cases", validFrom: "2026-10-01", validTo: "2026-12-31" },
  // Fictional extras, incl. one expired and one future scheme to exercise date rules
  { sku: "SKU-ND-070", type: "FREE_GOODS", buyQty: 5, freeQty: 1, label: "Buy 5 cases get 1 free", validFrom: "2026-10-15", validTo: "2026-11-30" },
  { sku: "SKU-DT-500", type: "SLAB_PERCENT", minQty: 10, percentBp: 250, label: "2.5% off 10 or more cases", validFrom: "2026-10-01", validTo: null },
  { sku: "SKU-NM-150", type: "FREE_GOODS", buyQty: 12, freeQty: 1, label: "Buy 12 cases get 1 free", validFrom: "2026-09-01", validTo: "2026-10-31" }, // expired
  { sku: "SKU-TE-500", type: "SLAB_PERCENT", minQty: 3, percentBp: 200, label: "2% off 3 or more cases", validFrom: "2026-11-15", validTo: "2026-12-31" }, // starts later
];

export type SeedRetailer = {
  code: string;
  shopName: string;
  ownerName: string;
  area: string;
  phone: string;
  salesman: "S1" | "S2";
  creditLimitPaise: number;
  outstandingPaise: number;
  /** Rough orders per week in generated history; 0 = dormant (for the 14-day dashboard). */
  ordersPerWeek: number;
  daysSinceLastOrder: number;
};

// Phone numbers are fictional (90000 xxxxx range) and used only for demo OTP login.
export const retailers: SeedRetailer[] = [
  { code: "RT-1001", shopName: "Sharma Kirana Store", ownerName: "Ramesh Sharma", area: "Wright Town", phone: "919000000001", salesman: "S1", creditLimitPaise: 15000000, outstandingPaise: 4250000, ordersPerWeek: 2, daysSinceLastOrder: 3 },
  { code: "RT-1002", shopName: "Gupta General Stores", ownerName: "Sunita Gupta", area: "Napier Town", phone: "919000000002", salesman: "S1", creditLimitPaise: 10000000, outstandingPaise: 9650000, ordersPerWeek: 1.5, daysSinceLastOrder: 5 },
  { code: "RT-1003", shopName: "Patel Provision", ownerName: "Mahesh Patel", area: "Adhartal", phone: "919000000003", salesman: "S1", creditLimitPaise: 8000000, outstandingPaise: 1200000, ordersPerWeek: 1, daysSinceLastOrder: 18 },
  { code: "RT-1004", shopName: "Jain Traders", ownerName: "Anil Jain", area: "Sadar", phone: "919000000004", salesman: "S1", creditLimitPaise: 25000000, outstandingPaise: 11000000, ordersPerWeek: 3, daysSinceLastOrder: 1 },
  { code: "RT-1005", shopName: "Maa Durga Kirana", ownerName: "Pooja Yadav", area: "Ranjhi", phone: "919000000005", salesman: "S1", creditLimitPaise: 5000000, outstandingPaise: 0, ordersPerWeek: 1, daysSinceLastOrder: 9 },
  { code: "RT-1006", shopName: "Verma Stores", ownerName: "Deepak Verma", area: "Garha", phone: "919000000006", salesman: "S1", creditLimitPaise: 6000000, outstandingPaise: 2300000, ordersPerWeek: 0.5, daysSinceLastOrder: 26 },
  { code: "RT-1007", shopName: "Khan Departmental Store", ownerName: "Imran Khan", area: "Gohalpur", phone: "919000000007", salesman: "S2", creditLimitPaise: 20000000, outstandingPaise: 7400000, ordersPerWeek: 2, daysSinceLastOrder: 2 },
  { code: "RT-1008", shopName: "Shri Ganesh Kirana", ownerName: "Kavita Tiwari", area: "Madan Mahal", phone: "919000000008", salesman: "S2", creditLimitPaise: 7500000, outstandingPaise: 3100000, ordersPerWeek: 1, daysSinceLastOrder: 15 },
  { code: "RT-1009", shopName: "Agrawal Super Mart", ownerName: "Rajesh Agrawal", area: "Vijay Nagar", phone: "919000000009", salesman: "S2", creditLimitPaise: 30000000, outstandingPaise: 12500000, ordersPerWeek: 3, daysSinceLastOrder: 0 },
  { code: "RT-1010", shopName: "Singh Kirana", ownerName: "Harpreet Singh", area: "Civil Lines", phone: "919000000010", salesman: "S2", creditLimitPaise: 6000000, outstandingPaise: 1800000, ordersPerWeek: 1, daysSinceLastOrder: 6 },
  { code: "RT-1011", shopName: "Saraswati Stores", ownerName: "Meena Dubey", area: "Gwarighat", phone: "919000000011", salesman: "S2", creditLimitPaise: 4000000, outstandingPaise: 600000, ordersPerWeek: 0, daysSinceLastOrder: 40 },
  { code: "RT-1012", shopName: "New Bharat Kirana", ownerName: "Sanjay Chouksey", area: "Kanchghar", phone: "919000000012", salesman: "S2", creditLimitPaise: 9000000, outstandingPaise: 4400000, ordersPerWeek: 1.5, daysSinceLastOrder: 4 },
];

export const staff = [
  { key: "D1", name: "Neha Soni", role: "desk", phone: "919000000100" },
  { key: "D2", name: "Arvind Kushwaha", role: "desk", phone: "919000000101" },
  { key: "S1", name: "Vikas Thakur", role: "salesman", phone: "919000000200" },
  { key: "S2", name: "Rahul Patel", role: "salesman", phone: "919000000201" },
] as const;

/** Inbound WhatsApp-style messages for the desk inbox. The first is verbatim from the brief. */
export const messages: { from: string; minutesAgo: number; body: string }[] = [
  { from: "919000000001", minutesAgo: 12, body: "bhaiya 5 peti biscuit chhota, 2 peti washing powder 1 kilo, chai patti 250 wala 1 peti" },
  { from: "919000000007", minutesAgo: 47, body: "Namaste bhai. 12 peti maggi type noodles, 6 peti surf 500 gm, neem sabun 2 peti. kal subah tak bhej dena" },
  { from: "919000000004", minutesAgo: 95, body: "भैया 10 पेटी ग्लूकोज बिस्कुट, 3 पेटी भुजिया बड़ा वाला, 5 चाय पत्ती 500 ग्राम" },
  { from: "919000000009", minutesAgo: 180, body: "Please send 20 cases glucose biscuit 75g, 8 cases detergent 1kg, 4 cases dishwash gel and 2 cases tea dust 250g" },
  { from: "919000000012", minutesAgo: 260, body: "bhaiya 24 biscuit cream wala aur 2 rusk. aur woh naya wala shampoo bhi" },
  { from: "919876500000", minutesAgo: 320, body: "hello mujhe bhi maal chahiye 3 peti chai" },
];
