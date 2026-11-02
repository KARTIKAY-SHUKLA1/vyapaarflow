/** Wordmark: a simple stacked-case mark + name. Inline SVG, no image request. */
export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 font-semibold tracking-tight text-ink">
      <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden>
        <rect x="3" y="11" width="8" height="8" rx="1.5" fill="var(--color-accent)" />
        <rect x="13" y="11" width="8" height="8" rx="1.5" fill="var(--color-accent)" opacity="0.55" />
        <rect x="8" y="3" width="8" height="7" rx="1.5" fill="var(--color-accent)" opacity="0.8" />
      </svg>
      {!compact && <span className="text-[17px]">VyapaarFlow</span>}
    </span>
  );
}
