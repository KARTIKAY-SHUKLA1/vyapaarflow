/**
 * Indian mobile numbers. Stored as 12 digits "91XXXXXXXXXX" (no "+").
 * Accepts "98xxxxxxxx", "+91 98xxx xxxxx", "098xxxxxxxx", "91-98xxxxxxxx".
 */
export function normalizeIndianMobile(input: string): string | null {
  const digits = input.replace(/[\s\-().+]/g, "");
  if (!/^\d+$/.test(digits)) return null;
  let local = digits;
  if (local.length === 12 && local.startsWith("91")) local = local.slice(2);
  else if (local.length === 11 && local.startsWith("0")) local = local.slice(1);
  if (!/^[6-9]\d{9}$/.test(local)) return null;
  return `91${local}`;
}

/** "919000000001" → "+91 90000 00001" */
export function formatIndianMobile(stored: string): string {
  const local = stored.startsWith("91") ? stored.slice(2) : stored;
  return `+91 ${local.slice(0, 5)} ${local.slice(5)}`;
}
