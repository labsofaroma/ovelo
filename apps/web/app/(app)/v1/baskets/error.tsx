"use client";

import {
  RouteError,
  type RouteErrorProps,
} from "@/features/shared/components/RouteError";

export default function BasketsError(props: RouteErrorProps) {
  return <RouteError {...props} title="Baskets could not be loaded" />;
}
