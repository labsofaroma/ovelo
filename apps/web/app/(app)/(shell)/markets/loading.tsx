import { PageSkeleton } from "@/features/shared/components/PageSkeleton";

export default function Loading() {
  return <PageSkeleton label="Loading markets" rows={10} />;
}
