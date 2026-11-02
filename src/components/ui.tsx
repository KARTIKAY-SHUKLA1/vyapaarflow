import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { Icon, type IconName } from "./icons";

/** Tiny class joiner; avoids a dependency. */
export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none select-none";
const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink hover:bg-accent-hover",
  secondary: "bg-surface text-ink border border-line-strong hover:bg-sunken",
  ghost: "text-ink-2 hover:bg-sunken hover:text-ink",
  danger: "bg-surface text-danger border border-danger/40 hover:bg-danger-soft",
};
// 44–52px tall: large tap targets for low-end phones (brief: "large tap targets").
const sizes: Record<Size, string> = {
  md: "h-11 px-4 text-[15px]",
  lg: "h-13 px-5 text-base w-full",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", extra?: string) {
  return cx(base, variants[variant], sizes[size], extra);
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: Variant; size?: Size }) {
  return <button className={buttonClass(variant, size, className)} {...props} />;
}

export function ButtonLink({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}

export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={cx("rounded-lg border border-line bg-surface shadow-card", className)} {...props} />;
}

type Tone = "neutral" | "accent" | "scheme" | "warn" | "danger" | "info";
const tones: Record<Tone, string> = {
  neutral: "bg-sunken text-ink-2",
  accent: "bg-accent-soft text-accent",
  scheme: "bg-scheme-soft text-scheme",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
};

export function Badge({ tone = "neutral", className, ...props }: ComponentProps<"span"> & { tone?: Tone }) {
  return (
    <span
      className={cx("inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-[13px] font-medium", tones[tone], className)}
      {...props}
    />
  );
}

export function Notice({ tone = "info", title, children }: { tone?: Tone; title?: string; children: ReactNode }) {
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cx("rounded-md px-4 py-3 text-[15px]", tones[tone])}>
      {title && <p className="font-semibold">{title}</p>}
      <div>{children}</div>
    </div>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-[15px] text-ink-2">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ title, body, action, icon }: { title: string; body?: string; action?: ReactNode; icon?: IconName }) {
  return (
    <div className="rounded-lg border border-dashed border-line-strong px-6 py-12 text-center">
      {icon && (
        <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-sunken text-ink-2">
          <Icon name={icon} size={26} />
        </span>
      )}
      <p className="font-semibold">{title}</p>
      {body && <p className="mx-auto mt-1 max-w-sm text-[15px] text-ink-2">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div aria-hidden className={cx("rounded-md bg-sunken motion-safe:animate-pulse", className)} style={style} />;
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "danger" | "warn" }) {
  return (
    <Card className="p-4">
      <p className="text-[13px] font-medium text-ink-3">{label}</p>
      <p className={cx("num mt-1 text-2xl font-semibold", tone === "danger" && "text-danger", tone === "warn" && "text-warn")}>
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[13px] text-ink-2">{hint}</p>}
    </Card>
  );
}
