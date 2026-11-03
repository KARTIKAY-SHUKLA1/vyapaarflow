import { isIP } from "node:net";

type HeaderReader = { get(name: string): string | null };
type Env = Record<string, string | undefined>;

/**
 * The client IP for abuse limits, or null when it cannot be trusted.
 *
 * Forwarded headers are only trusted on Vercel (VERCEL=1). There the edge network
 * sets `x-real-ip` and overwrites any `x-forwarded-for` the client sent, so neither
 * can be spoofed. Anywhere else (local runs, e2e, an unknown proxy) those headers
 * come straight from the client and are ignored: callers then skip per-IP limits
 * and rely on the global and per-phone limits.
 *
 * IPv6 addresses are reduced to their /64 prefix, because one user or device
 * normally controls a whole /64 and could otherwise rotate through addresses.
 */
export function clientIp(headers: HeaderReader, env: Env = process.env): string | null {
  if (env.VERCEL !== "1") return null;
  const candidate = headers.get("x-real-ip")?.trim() || headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "";
  return normalizeIp(candidate);
}

/** A valid IPv4 address as given, an IPv6 address as its /64 prefix, else null. */
export function normalizeIp(raw: string): string | null {
  const ip = raw.trim();
  const version = isIP(ip);
  if (version === 4) return ip;
  if (version !== 6) return null;

  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped && isIP(mapped[1]) === 4) return mapped[1]; // IPv4-mapped IPv6

  const groups = expandIpv6(ip);
  return groups ? `${groups.slice(0, 4).join(":")}::/64` : null;
}

/** "2001:db8::1" → ["2001","db8","0","0","0","0","0","1"] (lower-case, no leading zeros). */
function expandIpv6(ip: string): string[] | null {
  const [head, tail, extra] = ip.toLowerCase().split("::");
  if (extra !== undefined) return null;
  const left = head ? head.split(":") : [];
  const right = tail !== undefined && tail ? tail.split(":") : [];
  if (right.some((g) => g.includes(".")) || left.some((g) => g.includes("."))) {
    // Embedded IPv4 in the last 32 bits: the /64 prefix is unaffected; drop it.
    const strip = (gs: string[]) => gs.filter((g) => !g.includes("."));
    return expandIpv6Parts(strip(left), strip(right), tail !== undefined, 6);
  }
  return expandIpv6Parts(left, right, tail !== undefined, 8);
}

function expandIpv6Parts(left: string[], right: string[], compressed: boolean, total: number): string[] | null {
  const missing = total - left.length - right.length;
  if (missing < 0 || (!compressed && missing !== 0)) return null;
  const groups = [...left, ...Array(missing).fill("0"), ...right];
  if (groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => String(parseInt(g, 16).toString(16)));
}
