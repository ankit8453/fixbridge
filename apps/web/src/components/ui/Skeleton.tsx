/**
 * A pulsing placeholder block, for the moment before a query resolves where
 * `Spinner`'s "loading" label would appear and disappear too fast to read on
 * a fast connection, but the layout should not jump when data lands — a
 * skeleton reserves the shape the content will take.
 */
export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`animate-pulse rounded-md bg-slate-200 ${className}`} aria-hidden="true" />
  );
}

/** A few lines of skeleton text — the common case (a card's title + two detail lines). */
export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <div className="flex flex-col gap-2" role="status" aria-label="Loading">
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} className={`h-4 ${index === lines - 1 ? 'w-2/3' : 'w-full'}`} />
      ))}
    </div>
  );
}
