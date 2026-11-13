"use client";

import {
  RouteError,
  type RouteErrorProps,
} from "@/features/shared/components/RouteError";

export default function MarketsError(props: RouteErrorProps) {
  return <RouteError {...props} title="Markets could not be loaded" />;
}
