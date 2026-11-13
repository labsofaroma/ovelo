"use client";

import {
  RouteError,
  type RouteErrorProps,
} from "@/features/shared/components/RouteError";

export default function NewBasketError(props: RouteErrorProps) {
  return (
    <RouteError {...props} title="The basket builder could not be loaded" />
  );
}
