import { PageSkeleton } from "@/features/shared/components/PageSkeleton";

export default function Loading() {
  return <PageSkeleton label="Loading your watchlist" rows={4} />;
}
