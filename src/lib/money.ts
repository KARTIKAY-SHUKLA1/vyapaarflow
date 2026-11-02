const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 77760 → "₹777.60"; 12345600 → "₹1,23,456.00" (Indian digit grouping). */
export function formatPaise(paise: number): string {
  return inr.format(paise / 100);
}

/** Compact form for dashboards: 12345600 → "₹1.23 L". */
export function formatPaiseCompact(paise: number): string {
  const rupees = paise / 100;
  if (Math.abs(rupees) >= 1e7) return `₹${(rupees / 1e7).toFixed(2)} Cr`;
  if (Math.abs(rupees) >= 1e5) return `₹${(rupees / 1e5).toFixed(2)} L`;
  return formatPaise(paise);
}

/** 300 bp → "3%", 250 bp → "2.5%", 1800 bp → "18%" */
export function formatBp(bp: number): string {
  return `${Number((bp / 100).toFixed(2))}%`;
}
