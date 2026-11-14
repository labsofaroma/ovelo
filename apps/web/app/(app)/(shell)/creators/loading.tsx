import { PageSkeleton } from "@/features/shared/components/PageSkeleton";

export default function Loading() {
  return <PageSkeleton label="Loading creator baskets" rows={3} />;
}
