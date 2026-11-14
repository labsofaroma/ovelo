import { PageSkeleton } from "@/features/shared/components/PageSkeleton";

export default function Loading() {
  return <PageSkeleton label="Loading the basket builder" rows={4} />;
}
