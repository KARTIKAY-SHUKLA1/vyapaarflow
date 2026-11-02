import { Skeleton } from "./ui";

/** Loading state for list pages: title + a few rows. Detail pages render without one so 404s stay real 404s. */
export function PageSkeleton({ rows = 4, tiles = 0 }: { rows?: number; tiles?: number }) {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-8 w-56" />
      {tiles > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {Array.from({ length: tiles }, (_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      )}
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-24 w-full" />
      ))}
    </div>
  );
}
