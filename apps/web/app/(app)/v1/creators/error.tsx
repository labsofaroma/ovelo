"use client";

import {
  RouteError,
  type RouteErrorProps,
} from "@/features/shared/components/RouteError";

export default function CreatorsError(props: RouteErrorProps) {
  return <RouteError {...props} title="Creator baskets could not be loaded" />;
}
