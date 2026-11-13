"use client";

import { RouteError, type RouteErrorProps } from "@/features/shared/components/RouteError";

export default function StockError(props: RouteErrorProps) {
  return <RouteError {...props} title="This stock could not be loaded" />;
}
