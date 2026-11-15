import { Skeleton } from "@ovelo/ui";
import { pageContainer } from "../styles";

/** Shared `loading.tsx` body: shapes only, never placeholder numbers. Mirrors PageHeader + Sections. */
export function PageSkeleton({
  label,
  rows = 6,
}: {
  label: string;
  rows?: number;
}) {
  return (
    <main
      id="main-content"
      aria-busy="true"
      className={`${pageContainer} flex flex-col gap-4 md:gap-5`}
    >
      <h1 className="sr-only">{label}</h1>
      <div className="flex flex-col gap-3 py-2 md:py-4">
        <p
          role="status"
          className="inline-flex w-fit items-center rounded-full border border-line bg-raised-2 px-3 py-1 text-caption font-medium text-muted"
        >
          {label}…
        </p>
        <Skeleton className="h-12 w-72 max-w-full rounded-full" />
        <Skeleton className="h-5 w-[28rem] max-w-full rounded-full" />
      </div>
      <div className="flex flex-col gap-4 rounded-panel border border-line bg-surface p-5 edge-highlight md:p-8">
        <Skeleton className="h-7 w-48 rounded-full" />
        <div className="grid gap-3 md:grid-cols-3">
          <Skeleton className="h-24 rounded-tile" />
          <Skeleton className="h-24 rounded-tile" />
          <Skeleton className="h-24 rounded-tile" />
        </div>
      </div>
      <div className="flex flex-col gap-3 rounded-panel border border-line bg-surface p-5 edge-highlight md:p-8">
        {Array.from({ length: rows }, (_, index) => (
          <Skeleton key={index} className="h-12 w-full rounded-tile" />
        ))}
      </div>
    </main>
  );
}
