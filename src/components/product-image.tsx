import type { JSX, ReactNode } from "react";

/**
 * Product illustrations as inline SVG: a calm, flat drawing of each pack so the
 * catalogue shows large images without a single image request on slow 3G.
 * Server-component safe (no hooks, no state). Each key = one tone + one shape.
 */

type Tone = { bg: string; pack: string; tint: string };

// Muted tints that sit alongside the app's warm neutrals and deep green accent.
const TONES: Record<string, Tone> = {
  biscuit: { bg: "#fbf1dc", pack: "#a86f35", tint: "#e8c590" },
  "biscuit-cream": { bg: "#f4ece4", pack: "#74503d", tint: "#e3c69b" },
  rusk: { bg: "#faf0df", pack: "#9c6136", tint: "#e2b67e" },
  namkeen: { bg: "#fdf0de", pack: "#b0602f", tint: "#efc46e" },
  noodles: { bg: "#fbebe6", pack: "#a9503a", tint: "#f0d48c" },
  detergent: { bg: "#e7eff7", pack: "#2f5d86", tint: "#a9c5df" },
  bar: { bg: "#e9f0f6", pack: "#3e6a8c", tint: "#cde0ee" },
  dishwash: { bg: "#e6f0eb", pack: "#2e7356", tint: "#b7d9c7" },
  soap: { bg: "#e6f0eb", pack: "#1f5d46", tint: "#a9ceb9" },
  tea: { bg: "#f2ebe2", pack: "#6e3b2c", tint: "#7fa77f" },
  generic: { bg: "#f0eee8", pack: "#85827a", tint: "#d8d4ca" },
};

const W = "#ffffff";

/** A drawing plus where the pack label pill should sit (centre x, y). */
type Shape = (t: Tone) => { art: ReactNode; label: [number, number] };

function Leaf({ x, y, r = 0, s = 1, fill }: { x: number; y: number; r?: number; s?: number; fill: string }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${r}) scale(${s})`}>
      <path d="M0 -14C10 -8 10 8 0 14C-10 8 -10 -8 0 -14Z" fill={fill} />
      <path d="M0 -9V10" stroke={W} strokeWidth="1.6" strokeLinecap="round" opacity="0.7" />
    </g>
  );
}

/** Wrapped rectangular biscuit packet with crimped ends; contents peek out above. */
function packet(t: Tone, peek: ReactNode): ReturnType<Shape> {
  return {
    label: [60, 72],
    art: (
      <>
        {peek}
        <rect x="10" y="42" width="12" height="44" rx="2" fill={t.pack} opacity="0.7" />
        <rect x="98" y="42" width="12" height="44" rx="2" fill={t.pack} opacity="0.7" />
        <rect x="18" y="38" width="84" height="52" rx="6" fill={t.pack} />
        <rect x="26" y="44" width="38" height="4" rx="2" fill={W} opacity="0.3" />
      </>
    ),
  };
}

const SHAPES: Record<string, Shape> = {
  biscuit: (t) =>
    packet(
      t,
      [44, 70].map((cx, i) => (
        <g key={cx}>
          <circle cx={cx} cy={i ? 36 : 38} r="15" fill={t.tint} />
          <circle cx={cx - 5} cy={i ? 32 : 34} r="1.6" fill={W} opacity="0.8" />
          <circle cx={cx + 5} cy={i ? 32 : 34} r="1.6" fill={W} opacity="0.8" />
        </g>
      )),
    ),
  "biscuit-cream": (t) =>
    packet(
      t,
      <g>
        <rect x="34" y="18" width="52" height="10" rx="5" fill={t.tint} />
        <rect x="37" y="27" width="46" height="6" rx="3" fill={W} />
        <rect x="34" y="32" width="52" height="10" rx="5" fill={t.tint} />
      </g>,
    ),
  rusk: (t) => ({
    label: [60, 82],
    art: (
      <>
        <path d="M34 22H86L90 96Q90 102 84 102H36Q30 102 30 96Z" fill={t.pack} />
        <rect x="32" y="14" width="56" height="10" rx="2" fill={t.pack} opacity="0.75" />
        <rect x="42" y="34" width="36" height="32" rx="5" fill={W} opacity="0.9" />
        {[48, 58, 68].map((x) => (
          <rect key={x} x={x - 3} y="39" width="8" height="22" rx="2.5" fill={t.tint} transform={`rotate(12 ${x} 50)`} />
        ))}
      </>
    ),
  }),
  namkeen: (t) => ({
    label: [60, 78],
    art: (
      <>
        <path d="M20 26Q60 18 100 26L96 94Q60 102 24 94Z" fill={t.pack} />
        <path d="M20 26Q60 18 100 26L100 32Q60 24 20 32Z" fill={W} opacity="0.25" />
        <ellipse cx="60" cy="52" rx="24" ry="15" fill={W} opacity="0.9" />
        <path
          d="M42 50q4-4 8 0t8 0 8 0 8 0M46 57q4-4 8 0t8 0 8 0"
          fill="none"
          stroke={t.tint}
          strokeWidth="3"
          strokeLinecap="round"
        />
      </>
    ),
  }),
  noodles: (t) => ({
    label: [60, 80],
    art: (
      <>
        <rect x="14" y="30" width="92" height="64" rx="5" fill={t.pack} />
        <rect x="14" y="30" width="92" height="8" rx="4" fill={W} opacity="0.2" />
        <rect x="30" y="42" width="60" height="26" rx="6" fill={W} opacity="0.9" />
        <path
          d="M36 50q4-4 8 0t8 0 8 0 8 0 8 0 4 0M36 58q4-4 8 0t8 0 8 0 8 0 8 0 4 0"
          fill="none"
          stroke={t.tint}
          strokeWidth="3"
          strokeLinecap="round"
        />
      </>
    ),
  }),
  detergent: (t) => ({
    label: [54, 82],
    art: (
      <>
        <path d="M28 28L44 18H94L78 28Z" fill={t.tint} />
        <path d="M78 28L94 18V90L78 100Z" fill={t.pack} opacity="0.7" />
        <rect x="28" y="28" width="50" height="72" fill={t.pack} />
        <circle cx="46" cy="50" r="9" fill={W} opacity="0.9" />
        <circle cx="61" cy="44" r="5" fill={W} opacity="0.7" />
        <circle cx="60" cy="60" r="6" fill={W} opacity="0.8" />
      </>
    ),
  }),
  bar: (t) => ({
    label: [60, 76],
    art: (
      <>
        <rect x="14" y="48" width="92" height="42" rx="5" fill={t.pack} />
        <rect x="28" y="28" width="64" height="30" rx="11" fill={t.tint} />
        <rect x="36" y="34" width="26" height="4" rx="2" fill={W} opacity="0.8" />
      </>
    ),
  }),
  dishwash: (t) => ({
    label: [60, 74],
    art: (
      <>
        <rect x="51" y="10" width="18" height="10" rx="2" fill={t.pack} opacity="0.75" />
        <path d="M54 20H66L72 28H48Z" fill={t.pack} opacity="0.85" />
        <path d="M44 28H76Q82 28 82 34L86 96Q86 104 78 104H42Q34 104 34 96L38 34Q38 28 44 28Z" fill={t.pack} />
        <rect x="44" y="36" width="4" height="54" rx="2" fill={W} opacity="0.3" />
        <path d="M60 42C65 49 67 53 67 56A7 7 0 0 1 53 56C53 53 55 49 60 42Z" fill={t.tint} />
      </>
    ),
  }),
  soap: (t) => ({
    label: [60, 76],
    art: (
      <>
        <path d="M22 40L30 32H90L98 40Z" fill={t.tint} />
        <rect x="22" y="40" width="76" height="50" rx="4" fill={t.pack} />
        <Leaf x={54} y={58} r={-35} s={0.8} fill={t.tint} />
        <Leaf x={66} y={56} r={30} s={0.65} fill={t.tint} />
      </>
    ),
  }),
  tea: (t) => ({
    label: [60, 84],
    art: (
      <>
        <rect x="32" y="18" width="56" height="84" rx="5" fill={t.pack} />
        <rect x="32" y="18" width="56" height="12" rx="5" fill={W} opacity="0.18" />
        <circle cx="60" cy="54" r="17" fill={W} opacity="0.9" />
        <Leaf x={56} y={55} r={-30} s={0.75} fill={t.tint} />
        <Leaf x={66} y={53} r={35} s={0.6} fill={t.tint} />
      </>
    ),
  }),
  generic: (t) => ({
    label: [60, 78],
    art: (
      <>
        <path d="M26 36L34 26H86L94 36Z" fill={t.tint} />
        <rect x="26" y="36" width="68" height="58" rx="4" fill={t.pack} />
        <rect x="53" y="36" width="14" height="26" fill={t.tint} opacity="0.8" />
      </>
    ),
  }),
};

function PackLabel({ x, y, text, color }: { x: number; y: number; text: string; color: string }) {
  const s = text.length > 10 ? `${text.slice(0, 9)}…` : text;
  const w = Math.max(28, s.length * 6.2 + 14);
  return (
    <g>
      <rect x={x - w / 2} y={y - 8} width={w} height="16" rx="8" fill={W} opacity="0.94" />
      <text
        x={x}
        y={y}
        fill={color}
        fontSize="10"
        fontWeight="600"
        textAnchor="middle"
        dominantBaseline="central"
        style={{ fontFamily: "inherit" }}
      >
        {s}
      </text>
    </g>
  );
}

const SIZES = { sm: "w-14 h-14", md: "w-24 h-24", lg: "w-full aspect-square" } as const;

export function ProductImage({
  imageKey,
  label,
  size = "md",
  className,
  alt,
}: {
  imageKey: string;
  label?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
  alt: string;
}): JSX.Element {
  const key = imageKey in SHAPES ? imageKey : "generic";
  const tone = TONES[key];
  const { art, label: at } = SHAPES[key](tone);
  const text = label?.trim();
  return (
    <span
      className={["block shrink-0 overflow-hidden rounded-md", SIZES[size], className].filter(Boolean).join(" ")}
      style={{ backgroundColor: tone.bg }}
    >
      <svg role="img" aria-label={alt} viewBox="0 0 120 120" width="100%" className="block h-auto w-full">
        <g aria-hidden="true">
          <ellipse cx="60" cy="107" rx="38" ry="4" fill={tone.pack} opacity="0.12" />
          {art}
          {text ? <PackLabel x={at[0]} y={at[1]} text={text} color={tone.pack} /> : null}
        </g>
      </svg>
    </span>
  );
}
