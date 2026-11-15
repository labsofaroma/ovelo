"use client";

import {
  RouteError,
  type RouteErrorProps,
} from "@/features/shared/components/RouteError";

export default function MarketingError(props: RouteErrorProps) {
  return <RouteError {...props} />;
}
