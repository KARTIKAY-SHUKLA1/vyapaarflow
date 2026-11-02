import { Skeleton } from "./ui";

/**
 * Loading states shaped like the real pages, so nothing jumps when content arrives.
 * Pure markup + CSS (no client JS). Detail pages have none, so their 404s stay real 404s.
 */

function Busy({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={className} aria-busy="true" aria-label="Loading">
      {children}
    </div>
  );
}

/** One catalogue card: square image, name, badges, price row with the Add button. */
function ProductCardSkeleton() {
  return (
    <div className="flex gap-3 rounded-lg border border-line bg-surface p-3">
      <Skeleton className="h-24 w-24 shrink-0 rounded-lg" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-5 w-20 rounded-sm" />
        <Skeleton className="h-3 w-3/5" />
        <div className="mt-auto flex items-end justify-between gap-2">
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-11 w-20" />
        </div>
      </div>
    </div>
  );
}

export function CatalogueSkeleton() {
  return (
    <Busy className="space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-44" />
      </div>
      <Skeleton className="h-12 w-full" />
      <div className="flex gap-2 overflow-hidden">
        {[16, 20, 22, 20, 16].map((w, i) => (
          <Skeleton key={i} className="h-10 shrink-0" style={{ width: `${w * 4}px`, borderRadius: 999 }} />
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <ProductCardSkeleton key={i} />
        ))}
      </div>
    </Busy>
  );
}

export function OrdersSkeleton() {
  return (
    <Busy className="space-y-4">
      <Skeleton className="h-7 w-40" />
      <div className="space-y-3">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="space-y-2 rounded-lg border border-line bg-surface p-4">
            <div className="flex justify-between gap-3">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-20" />
            </div>
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-2 w-full rounded-full" />
          </div>
        ))}
      </div>
    </Busy>
  );
}

export function DeskOverviewSkeleton() {
  return (
    <Busy className="space-y-5">
      <Skeleton className="h-7 w-40" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="space-y-2 rounded-lg border border-line bg-surface p-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-10" />
          </div>
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="space-y-3 rounded-lg border border-line bg-surface p-4">
            <Skeleton className="h-4 w-32" />
            {Array.from({ length: 4 }, (_, j) => (
              <Skeleton key={j} className="h-10 w-full" />
            ))}
          </div>
        ))}
      </div>
    </Busy>
  );
}

/** Filter chips + table rows (cards on phones), as on the desk queue. */
export function DeskQueueSkeleton() {
  return (
    <Busy className="space-y-4">
      <Skeleton className="h-7 w-32" />
      <div className="flex gap-2 overflow-hidden">
        {[16, 22, 22, 20, 20].map((w, i) => (
          <Skeleton key={i} className="h-10 shrink-0" style={{ width: `${w * 4}px`, borderRadius: 999 }} />
        ))}
      </div>
      <div className="divide-y divide-line rounded-lg border border-line bg-surface">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="flex items-center justify-between gap-4 px-4 py-3.5">
            <div className="space-y-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-40" />
            </div>
            <Skeleton className="h-5 w-20" />
          </div>
        ))}
      </div>
    </Busy>
  );
}

export function InboxSkeleton() {
  return (
    <Busy className="space-y-4">
      <Skeleton className="h-7 w-32" />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-3">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="space-y-2 rounded-lg border border-line bg-surface p-4">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-4 w-full" />
              <div className="flex justify-between">
                <Skeleton className="h-5 w-14" />
                <Skeleton className="h-11 w-32" />
              </div>
            </div>
          ))}
        </div>
        <Skeleton className="hidden h-72 w-full lg:block" />
      </div>
    </Busy>
  );
}

export function ExportSkeleton() {
  return (
    <Busy className="space-y-4">
      <Skeleton className="h-7 w-40" />
      <Skeleton className="h-4 w-3/4" />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="divide-y divide-line rounded-lg border border-line bg-surface">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3">
              <Skeleton className="h-5 w-5" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
        <Skeleton className="h-48 w-full" />
      </div>
    </Busy>
  );
}
