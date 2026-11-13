import { Skeleton } from "@aroma/ui";
import { pageContainer } from "../styles";

/** Shared `loading.tsx` body: shapes only, never placeholder numbers. */
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
      className={`${pageContainer} flex flex-col gap-4 py-8`}
    >
      <h1 className="sr-only">{label}</h1>
      <p role="status" className="text-small text-muted">
        {label}…
      </p>
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-24 w-full" />
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-12 w-full" />
      ))}
    </main>
  );
}
