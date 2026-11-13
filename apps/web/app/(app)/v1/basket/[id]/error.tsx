"use client";

import {
  RouteError,
  type RouteErrorProps,
} from "@/features/shared/components/RouteError";

export default function BasketError(props: RouteErrorProps) {
  return <RouteError {...props} title="This basket could not be loaded" />;
}
